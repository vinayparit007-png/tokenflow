import type { Usage } from "../usage.js";
import { mergeUsage } from "./merge.js";

/** OpenAI's usage object, present only on the final streamed chunk when
 * `stream_options: { include_usage: true }` was set on the request. */
export interface OpenAIUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

/** A streamed OpenAI chat completion chunk. `usage` is null on every chunk
 * except the final one. */
export interface OpenAIEvent {
  usage?: OpenAIUsage | null;
  [key: string]: unknown;
}

/**
 * Reduce one OpenAI chunk into the running usage total.
 *
 * Why the subtraction: OpenAI reports `cached_tokens` as a component *inside*
 * `prompt_tokens`. If we passed `prompt_tokens` straight to `input` we'd bill the
 * cached tokens twice — once at the input rate and once at the cache-read rate.
 * We subtract to keep `input` and `cacheRead` disjoint (decision 5). OpenAI has
 * no separate cache-write charge, so `cacheWrite` stays 0. The usage-bearing
 * chunk is terminal, so it also marks the turn complete.
 */
export function adaptOpenAI(usage: Usage, event: OpenAIEvent): Usage {
  const u = event.usage;
  if (!u) return usage;
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const reasoning = u.completion_tokens_details?.reasoning_tokens ?? 0;
  return mergeUsage(usage, {
    input: u.prompt_tokens - cached,
    cacheRead: cached,
    output: u.completion_tokens,
    reasoning,
    cacheWrite: 0,
    complete: true,
  });
}
