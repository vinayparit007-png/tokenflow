import { emptyUsage, type Usage } from "../usage.js";
import type { ModelRates } from "../pricing/loader.js";
import { costOf } from "../cost.js";
import type { Provider, ChatRequest, StreamOptions } from "../providers/index.js";
import { ProviderError, isAbortError } from "../providers/index.js";

/** The fully-collected outcome of one model's turn (no live rendering).
 * `provider` is a display/history label — see the note on `Provider.name`. */
export interface TurnResult {
  provider: string;
  model: string;
  text: string;
  usage: Usage;
  cost: bigint | null;
  latencyMs: number;
  ttftMs: number | null;
  /** Set when the turn failed; the other fields hold whatever arrived first. */
  error?: Error;
}

/**
 * Stream a turn to completion and return everything about it, capturing (rather
 * than throwing) a provider error so a fan-out can report a partial failure. A
 * user abort still propagates — cancelling one model cancels the whole run.
 */
export async function collectTurn(
  provider: Provider,
  model: string,
  rates: ModelRates | null,
  request: ChatRequest,
  options: StreamOptions,
  now: () => number = Date.now,
): Promise<TurnResult> {
  let usage: Usage = emptyUsage();
  let text = "";
  let ttftMs: number | null = null;
  let error: Error | undefined;
  const start = now();

  try {
    for await (const event of provider.stream(request, options)) {
      switch (event.type) {
        case "text":
          if (ttftMs === null) ttftMs = now() - start;
          text += event.text;
          break;
        case "usage":
          usage = event.usage;
          break;
        case "error":
          error = event.error;
          break;
        case "done":
          break;
      }
    }
  } catch (caught) {
    if (isAbortError(caught)) throw caught; // cancellation cancels the whole run
    error = caught instanceof Error ? caught : new ProviderError(provider.name, String(caught));
  }

  return {
    provider: provider.name,
    model,
    text,
    usage,
    cost: costOf(usage, rates),
    latencyMs: now() - start,
    ttftMs,
    ...(error ? { error } : {}),
  };
}
