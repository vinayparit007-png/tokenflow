import type { ProviderName } from "../adapters/index.js";
import { emptyUsage, type Usage } from "../usage.js";
import type { PricingTable } from "../pricing/loader.js";
import type { Provider, ChatRequest, Message, StreamOptions } from "../providers/index.js";
import { ProviderError, FixtureRecorder, isAbortError } from "../providers/index.js";
import { formatCost } from "../format.js";
import type { Terminal } from "./tty.js";
import type { Config } from "./config.js";
import { resolveModel } from "./config.js";
import { MarkdownStream } from "./render.js";
import { CostEstimator, estimateOutputTokens } from "./costline.js";
import { DriftLogger } from "./drift.js";
import { ExitCode } from "./exit.js";
import { paint, type Theme } from "./theme.js";
import type { ChatCommand } from "./args.js";

/** Everything a chat run needs, injected so the whole flow is testable offline. */
export interface CliDeps {
  providers: Record<ProviderName, Provider>;
  pricing: PricingTable;
  config: Config;
  terminal: Terminal;
  env: NodeJS.ProcessEnv;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  /** Retry budget for provider calls; defaults to the provider default (3). */
  maxRetries?: number;
  /** Terminal theme for accents; defaults to a plain look when omitted. */
  theme?: Theme;
  drift?: DriftLogger;
  /** Content piped in via stdin, already read. */
  stdinText?: string;
  /** Prior turns for `--continue`; prepended to the request. */
  history?: Message[];
  /** Called after a turn completes (for the history store, Phase 5). */
  onTurn?: (turn: CompletedTurn) => void;
}

/** The outcome of one completed turn. */
export interface CompletedTurn {
  provider: ProviderName;
  model: string;
  request: Message[];
  system?: string;
  responseText: string;
  usage: Usage;
  cost: bigint | null;
  latencyMs: number;
  ttftMs: number | null;
}

/** Combine a prompt argument and piped stdin into one user message body. */
export function buildUserContent(prompt: string | undefined, stdinText: string | undefined): string {
  const p = prompt?.trim();
  const s = stdinText?.trim();
  if (p && s) return `${p}\n\n${s}`;
  return p ?? s ?? "";
}

/**
 * Run a single-model, one-shot chat turn end to end: resolve the model, stream
 * the response through the renderer, track live cost, snap to truth, log drift,
 * and print the cost line to the right channel. Returns a process exit code.
 */
export async function runChat(cmd: ChatCommand, deps: CliDeps): Promise<number> {
  const { terminal } = deps;

  const content = buildUserContent(cmd.prompt, deps.stdinText);
  if (content === "") {
    terminal.err("No prompt given. Try: tokenflow \"your question\"\n");
    return ExitCode.Usage;
  }

  const modelName = cmd.models[0] ?? deps.config.defaultModel ?? "claude-opus-4-8";
  let resolved;
  try {
    resolved = resolveModel(modelName, deps.config, deps.pricing);
  } catch (error) {
    terminal.err(`${(error as Error).message}\n`);
    return ExitCode.Usage;
  }

  const apiKey = deps.env[resolved.keyEnv];
  if (!apiKey) {
    terminal.err(
      `${resolved.keyEnv} not set — add it to your shell (e.g. \`export ${resolved.keyEnv}=...\`) ` +
        `or set \`providers.${resolved.provider}.keyEnv\` in ~/.tokenflow/config.json.\n`,
    );
    return ExitCode.Provider;
  }

  const provider = deps.providers[resolved.provider];
  const messages: Message[] = [...(deps.history ?? []), { role: "user", content }];
  const request: ChatRequest = {
    model: resolved.model,
    messages,
    ...(cmd.system !== undefined ? { system: cmd.system } : {}),
    ...(cmd.maxTokens !== undefined ? { maxTokens: cmd.maxTokens } : {}),
  };

  const rates = deps.pricing.rates(resolved.provider, resolved.model);
  const recorder = cmd.record ? new FixtureRecorder(resolved.provider, resolved.model) : null;
  const renderer = new MarkdownStream(terminal);
  // Tracks characters/usage as they stream so the final cost is exact and the
  // drift log gets a real estimate to calibrate against — it draws nothing to
  // the screen (see the note in costline.ts on why the old live redraw is gone).
  const costEstimator = new CostEstimator(rates);

  const streamOptions: StreamOptions = {
    ...(deps.signal ? { signal: deps.signal } : {}),
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.maxRetries !== undefined ? { maxRetries: deps.maxRetries } : {}),
    apiKey,
    ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
    ...(recorder ? { onRawEvent: recorder.capture } : {}),
  };

  let usage: Usage = emptyUsage();
  let responseText = "";
  const start = Date.now();
  let ttft: number | null = null;
  let failed: ProviderError | null = null;

  try {
    for await (const event of provider.stream(request, streamOptions)) {
      switch (event.type) {
        case "text":
          if (ttft === null) ttft = Date.now() - start;
          responseText += event.text;
          costEstimator.addChars(event.text.length);
          if (!cmd.json && cmd.stream) renderer.feed(event.text);
          break;
        case "usage":
          usage = event.usage;
          costEstimator.setInputFrom(event.usage);
          break;
        case "error":
          failed = event.error;
          break;
        case "done":
          break;
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      terminal.err(terminal.c.dim("\n[cancelled]\n"));
      return ExitCode.Cancelled;
    }
    throw error;
  }

  if (failed) {
    terminal.err(`\n${terminal.c.red(`Error (${failed.provider}): ${failed.message}`)}\n`);
    return ExitCode.Provider;
  }

  if (!cmd.json && cmd.stream) renderer.flush();
  const cost = costEstimator.actual(usage).nanodollars;
  const latencyMs = Date.now() - start;

  if (cmd.json) {
    emitJson(terminal, resolved.provider, resolved.model, responseText, usage, cost, latencyMs, ttft);
  } else {
    if (!cmd.stream) terminal.out(responseText.endsWith("\n") ? responseText : `${responseText}\n`);
    terminal.cost(`\n${formatCostLine(terminal, resolved.model, usage, cost, deps.theme)}\n`);
    warnIfUnpriced(terminal, cost, resolved.model);
  }

  if (recorder && cmd.record) recorder.save(cmd.record);
  (deps.drift ?? new DriftLogger()).record(
    resolved.model,
    estimateOutputTokens(costEstimator.charsSeen()),
    usage.output,
  );

  deps.onTurn?.({
    provider: resolved.provider,
    model: resolved.model,
    request: messages,
    ...(cmd.system !== undefined ? { system: cmd.system } : {}),
    responseText,
    usage,
    cost,
    latencyMs,
    ttftMs: ttft,
  });

  return ExitCode.Success;
}

/** A one-line cost/usage footer: `model · N in / M out (+cache) · $x`. The model
 * name and the dollar figure pick up the theme accent when one is supplied. */
export function formatCostLine(
  terminal: Terminal,
  model: string,
  usage: Usage,
  cost: bigint | null,
  theme?: Theme,
): string {
  const { c } = terminal;
  const modelLabel = theme ? paint(model, theme.accent, terminal, true) : c.bold(model);
  const costLabel = theme ? paint(formatCost(cost), theme.accent, terminal, true) : c.bold(formatCost(cost));
  const cacheNote =
    usage.cacheRead > 0 || usage.cacheWrite > 0
      ? c.dim(` (cache ${usage.cacheRead}r/${usage.cacheWrite}w)`)
      : "";
  return (
    modelLabel +
    c.dim(
      ` · ${usage.input} in / ${usage.output} out${usage.reasoning > 0 ? ` (${usage.reasoning} reasoning)` : ""}${cacheNote} · `,
    ) +
    costLabel
  );
}

function warnIfUnpriced(terminal: Terminal, cost: bigint | null, model: string): void {
  if (cost === null) {
    terminal.cost(terminal.c.yellow(`  note: no pricing for "${model}" — cost shown as ?\n`));
  }
}

function emitJson(
  terminal: Terminal,
  provider: ProviderName,
  model: string,
  text: string,
  usage: Usage,
  cost: bigint | null,
  latencyMs: number,
  ttftMs: number | null,
): void {
  const payload = {
    provider,
    model,
    text,
    usage,
    cost_nanodollars: cost === null ? null : cost.toString(),
    cost_usd: cost === null ? null : Number(cost) / 1e9,
    latency_ms: latencyMs,
    ttft_ms: ttftMs,
  };
  terminal.out(`${JSON.stringify(payload, null, 2)}\n`);
}
