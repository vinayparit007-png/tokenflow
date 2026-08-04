import { emptyUsage } from "../usage.js";
import { isAbortError, type ChatRequest, type Message, type StreamOptions } from "../providers/index.js";
import { SessionCost } from "../session.js";
import { formatCost } from "../format.js";
import { resolveModel } from "./config.js";
import type { Terminal } from "./tty.js";
import { gradient } from "./theme.js";
import { MarkdownStream } from "./render.js";
import { collectTurn, type TurnResult } from "./turn.js";
import { renderTable, type Column } from "./table.js";
import { ExitCode } from "./exit.js";
import { buildUserContent, type CliDeps } from "./run.js";
import type { ChatCommand } from "./args.js";

/**
 * Run one prompt against several models at once (`-m a,b,c`).
 *
 * Requests fire in PARALLEL but responses render in SEQUENCE (buffered), because
 * interleaving three live streams in a plain terminal is unreadable. Each model
 * gets a footer (tokens, cost, latency, TTFT) and the run ends with a comparison
 * table. A single provider failing is captured, not fatal (graceful partial
 * failure); only a user Ctrl-C cancels the whole run.
 */
export async function runFanout(cmd: ChatCommand, deps: CliDeps): Promise<number> {
  const { terminal } = deps;
  const content = buildUserContent(cmd.prompt, deps.stdinText);
  if (content === "") {
    terminal.err('No prompt given. Try: tokenflow -m claude,gpt "your question"\n');
    return ExitCode.Usage;
  }

  const messages: Message[] = [{ role: "user", content }];

  // Kick every model off in parallel; a resolution/key error becomes a failed
  // result rather than throwing, so the other models still run.
  const tasks = cmd.models.map(async (name): Promise<TurnResult> => {
    try {
      const resolved = resolveModel(name, deps.config, deps.pricing);
      const apiKey = deps.env[resolved.keyEnv];
      if (!apiKey) {
        return failed(name, name, `${resolved.keyEnv} not set`);
      }
      const provider = deps.providers[resolved.provider];
      const rates = deps.pricing.rates(resolved.provider, resolved.model);
      const request: ChatRequest = {
        model: resolved.model,
        messages,
        ...(cmd.system !== undefined ? { system: cmd.system } : {}),
        ...(cmd.maxTokens !== undefined ? { maxTokens: cmd.maxTokens } : {}),
      };
      const options: StreamOptions = {
        ...(deps.signal ? { signal: deps.signal } : {}),
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.maxRetries !== undefined ? { maxRetries: deps.maxRetries } : {}),
        apiKey,
        ...(resolved.baseUrl ? { baseUrl: resolved.baseUrl } : {}),
      };
      return await collectTurn(provider, resolved.model, rates, request, options);
    } catch (error) {
      if (isAbortError(error)) throw error;
      return failed(name, name, (error as Error).message);
    }
  });

  let results: TurnResult[];
  try {
    results = await Promise.all(tasks);
  } catch (error) {
    if (isAbortError(error)) {
      terminal.err(terminal.c.dim("\n[cancelled]\n"));
      return ExitCode.Cancelled;
    }
    throw error;
  }

  // Render each response in the order requested, followed by its footer.
  for (const result of results) {
    const heading = deps.theme
      ? gradient(`■ ${result.model}`, deps.theme, terminal, true)
      : terminal.c.bold(terminal.c.cyan(`■ ${result.model}`));
    terminal.out(`\n${heading}\n`);
    if (result.error) {
      terminal.out(terminal.c.red(`  ✗ ${result.error.message}\n`));
      continue;
    }
    const renderer = new MarkdownStream(terminal);
    renderer.feed(result.text.endsWith("\n") ? result.text : `${result.text}\n`);
    renderer.flush();
    terminal.cost(footer(result, terminal));
  }

  terminal.cost(`\n${comparisonTable(results, deps, terminal)}\n`);

  // Record each successful model as its own turn (all share the prompt).
  for (const r of results) {
    if (r.error) continue;
    deps.onTurn?.({
      provider: r.provider,
      model: r.model,
      request: messages,
      ...(cmd.system !== undefined ? { system: cmd.system } : {}),
      responseText: r.text,
      usage: r.usage,
      cost: r.cost,
      latencyMs: r.latencyMs,
      ttftMs: r.ttftMs,
    });
  }

  const anyOk = results.some((r) => !r.error);
  return anyOk ? ExitCode.Success : ExitCode.Provider;
}

/** A synthetic failed result for a model that never got to stream. */
function failed(model: string, label: string, message: string): TurnResult {
  return {
    provider: "anthropic",
    model: label || model,
    text: "",
    usage: emptyUsage(),
    cost: null,
    latencyMs: 0,
    ttftMs: null,
    error: new Error(message),
  };
}

/** One model's per-response footer line. */
function footer(r: TurnResult, terminal: Terminal): string {
  const ttft = r.ttftMs === null ? "—" : `${r.ttftMs}ms`;
  return terminal.c.dim(
    `  ${r.usage.input} in / ${r.usage.output} out · ${formatCost(r.cost)} · ${r.latencyMs}ms total · ttft ${ttft}\n`,
  );
}

/** The end-of-run comparison table plus the combined session total. */
function comparisonTable(results: TurnResult[], deps: CliDeps, terminal: Terminal): string {
  const columns: Column<TurnResult>[] = [
    { header: "MODEL", cell: (r) => (r.error ? terminal.c.red(r.model) : r.model) },
    { header: "IN", right: true, cell: (r) => (r.error ? "—" : String(r.usage.input)) },
    { header: "OUT", right: true, cell: (r) => (r.error ? "—" : String(r.usage.output)) },
    { header: "COST", right: true, cell: (r) => (r.error ? "—" : formatCost(r.cost)) },
    { header: "LATENCY", right: true, cell: (r) => (r.error ? "—" : `${r.latencyMs}ms`) },
    { header: "TTFT", right: true, cell: (r) => (r.ttftMs === null ? "—" : `${r.ttftMs}ms`) },
    { header: "", cell: (r) => (r.error ? terminal.c.red("failed") : "") },
  ];

  const session = new SessionCost(deps.pricing);
  for (const r of results) if (!r.error) session.record(r.provider, r.model, r.usage);

  const table = renderTable(results, columns, terminal);
  const total = terminal.c.bold(`total: ${formatCost(session.total())}`);
  return `${table}\n${total}`;
}
