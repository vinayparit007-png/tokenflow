import { emptyUsage, type Usage } from "../usage.js";
import type { ProviderAdapter } from "../adapters/index.js";
import { parseSSE } from "./sse.js";
import { postStream, resolveApiKey } from "./http.js";
import { ProviderError, type ChatRequest, type StreamEvent, type StreamOptions } from "./types.js";

/** The provider-specific pieces {@link createStream} needs; everything else
 * (retry, SSE parsing, usage diffing, cancellation) is shared.
 *
 * `provider` is a DISPLAY label (used only for error text and `Provider.name`),
 * independent of `adapter`, which selects the actual wire-format reducer. A
 * custom OpenAI-compatible lab sets `provider` to its own name (e.g.
 * `"deepseek"`) while still pointing `adapter` at `adapters.openai`. */
export interface StreamSpec {
  provider: string;
  keyEnv: string;
  defaultBaseUrl: string;
  /** Build the HTTP request for this provider. */
  buildRequest(request: ChatRequest, apiKey: string, baseUrl: string): { url: string; init: RequestInit };
  /** The event reducer that turns raw events into `Usage`. */
  adapter: ProviderAdapter;
  /** Extract streamed text from one raw event ("" if none). */
  extractText(event: unknown): string;
  /** Recognise a provider's in-band error event, or return null. */
  extractError(event: unknown): ProviderError | null;
  /** Recognise a stream-terminating sentinel line (e.g. OpenAI's `[DONE]`). */
  isDoneSentinel(data: string): boolean;
}

/** True if two usage snapshots are identical, so we only emit `usage` on change. */
function usageEqual(a: Usage, b: Usage): boolean {
  return (
    a.input === b.input &&
    a.output === b.output &&
    a.cacheWrite === b.cacheWrite &&
    a.cacheRead === b.cacheRead &&
    a.reasoning === b.reasoning &&
    a.complete === b.complete
  );
}

/** An abort surfaces as a DOMException/Error named "AbortError". */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * The one streaming loop shared by every provider. It resolves the key, opens the
 * retried connection, parses SSE, and yields the normalised event union.
 *
 * Cancellation vs. failure are handled differently on purpose: an abort
 * (Ctrl-C) propagates as a thrown AbortError so the caller can tear down without
 * recording a partial turn, whereas a provider/API failure is surfaced as a
 * `{ type: "error" }` event followed by no `done`, so scripts can distinguish
 * "user cancelled" from "the call failed".
 */
export async function* createStream(
  spec: StreamSpec,
  request: ChatRequest,
  options: StreamOptions = {},
): AsyncGenerator<StreamEvent> {
  let body: ReadableStream<Uint8Array>;
  try {
    const apiKey = resolveApiKey(spec.provider, spec.keyEnv, options);
    const baseUrl = options.baseUrl ?? spec.defaultBaseUrl;
    const { url, init } = spec.buildRequest(request, apiKey, baseUrl);
    body = await postStream(spec.provider, url, init, options);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof ProviderError) {
      yield { type: "error", error };
      return;
    }
    throw error;
  }

  let usage = emptyUsage();
  for await (const data of parseSSE(body)) {
    if (data === "") continue;
    if (spec.isDoneSentinel(data)) break;

    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      continue; // ignore keep-alives / non-JSON comments
    }

    options.onRawEvent?.(event);

    const inbandError = spec.extractError(event);
    if (inbandError) {
      yield { type: "error", error: inbandError };
      return;
    }

    const text = spec.extractText(event);
    if (text) yield { type: "text", text };

    const next = spec.adapter.adapt(usage, event);
    if (!usageEqual(next, usage)) {
      usage = next;
      yield { type: "usage", usage };
    }
  }

  yield { type: "done" };
}
