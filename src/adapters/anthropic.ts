import type { Usage } from "../usage.js";
import { mergeUsage } from "./merge.js";

/** Anthropic's usage object as it appears in `message_start` and `message_delta`. */
export interface AnthropicUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/**
 * The subset of Anthropic SSE events that carry token accounting. Non-usage
 * events (content_block_*, ping, etc.) are represented by the catch-all and
 * pass through unchanged.
 */
export type AnthropicEvent =
  | { type: "message_start"; message: { usage: AnthropicUsage } }
  | { type: "message_delta"; usage?: AnthropicUsage }
  | { type: "message_stop" }
  | { type: string; [key: string]: unknown };

/**
 * Reduce one Anthropic event into the running usage total.
 *
 * Why Anthropic needs no cache subtraction: unlike OpenAI and Gemini, Anthropic
 * reports `input_tokens`, `cache_creation_input_tokens`, and
 * `cache_read_input_tokens` as three separate, already-disjoint counts. We map
 * them straight across. `message_delta.usage.output_tokens` is the cumulative
 * running total — merged via high-water mark, so a duplicated or reordered delta
 * is a harmless no-op (see `mergeUsage`).
 */
export function adaptAnthropic(usage: Usage, event: AnthropicEvent): Usage {
  switch (event.type) {
    case "message_start": {
      const u = (event as Extract<AnthropicEvent, { type: "message_start" }>).message.usage;
      return mergeUsage(usage, {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheWrite: u.cache_creation_input_tokens,
        cacheRead: u.cache_read_input_tokens,
      });
    }
    case "message_delta": {
      const u = (event as Extract<AnthropicEvent, { type: "message_delta" }>).usage;
      return mergeUsage(usage, {
        input: u?.input_tokens,
        output: u?.output_tokens,
        cacheWrite: u?.cache_creation_input_tokens,
        cacheRead: u?.cache_read_input_tokens,
      });
    }
    case "message_stop":
      return mergeUsage(usage, { complete: true });
    default:
      return usage;
  }
}
