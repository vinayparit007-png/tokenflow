/**
 * Hand-written, plausible event streams matching each provider's documented SSE
 * shape, with the exact totals a correct adapter must produce.
 *
 * CAPTURE NOTE: these are hand-authored for Phase 1, not real recordings. Phase 2
 * replaces them with `--record`ed captures date-stamped with the real model id.
 * Frozen fixtures cannot catch a provider changing its wire format — that gap is
 * covered by the (Phase 2) shape-only live test gated behind an env var.
 */
import type { Usage } from "../../src/usage.js";
import type { ProviderName, ProviderAdapter } from "../../src/adapters/index.js";
import { adapters } from "../../src/adapters/index.js";

export interface AdapterFixture {
  provider: ProviderName;
  adapter: ProviderAdapter;
  /** Human note on what this stream exercises. */
  description: string;
  /** Ordered raw provider events, as they arrive over the wire. */
  events: unknown[];
  /** The exact Usage a correct fold must yield. */
  expected: Usage;
  /**
   * The single "prompt token count" this provider reports on the wire. The
   * contract invariant `input + cacheRead === reportedPromptCount` (decision 5)
   * proves cache tokens are counted once, not double-billed.
   */
  reportedPromptCount: number;
}

/**
 * Anthropic reports cache-creation and cache-read as fields SEPARATE from
 * `input_tokens`, and streams the final `output_tokens` in `message_delta`
 * (which starts at 1 in `message_start`).
 */
const anthropicFixture: AdapterFixture = {
  provider: "anthropic",
  adapter: adapters.anthropic,
  description: "message_start (output=1) then a cumulative message_delta; cache read + write present",
  events: [
    {
      type: "message_start",
      message: {
        usage: {
          input_tokens: 1000,
          output_tokens: 1,
          cache_creation_input_tokens: 50,
          cache_read_input_tokens: 200,
        },
      },
    },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello there." } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 300 } },
    { type: "message_stop" },
  ],
  expected: {
    input: 1000,
    output: 300,
    cacheWrite: 50,
    cacheRead: 200,
    reasoning: 0,
    complete: true,
  },
  // Anthropic has no single prompt-count field; the fresh + cache-read tokens.
  reportedPromptCount: 1200,
};

/**
 * OpenAI reports `cached_tokens` INSIDE `prompt_tokens`, and `reasoning_tokens`
 * inside `completion_tokens`. Usage arrives only on the final chunk (requires
 * `stream_options: { include_usage: true }`).
 */
const openaiFixture: AdapterFixture = {
  provider: "openai",
  adapter: adapters.openai,
  description: "content chunks with usage:null, then a terminal chunk carrying usage",
  events: [
    { choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }], usage: null },
    { choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: null }], usage: null },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: null },
    {
      choices: [],
      usage: {
        prompt_tokens: 1200,
        completion_tokens: 300,
        total_tokens: 1500,
        prompt_tokens_details: { cached_tokens: 200 },
        completion_tokens_details: { reasoning_tokens: 80 },
      },
    },
  ],
  expected: {
    input: 1000, // 1200 prompt - 200 cached
    output: 300,
    cacheWrite: 0,
    cacheRead: 200,
    reasoning: 80,
    complete: true,
  },
  reportedPromptCount: 1200,
};

/**
 * Gemini reports `cachedContentTokenCount` INSIDE `promptTokenCount`, and thinking
 * tokens in a SEPARATE `thoughtsTokenCount` that is not part of
 * `candidatesTokenCount` but is billed as output.
 */
const geminiFixture: AdapterFixture = {
  provider: "gemini",
  adapter: adapters.gemini,
  description: "streaming candidates, final chunk carries finishReason + usageMetadata",
  events: [
    { candidates: [{ content: { parts: [{ text: "Hel" }] }, index: 0 }] },
    { candidates: [{ content: { parts: [{ text: "lo" }] }, index: 0 }] },
    {
      candidates: [{ content: { parts: [{ text: "." }] }, finishReason: "STOP", index: 0 }],
      usageMetadata: {
        promptTokenCount: 1200,
        candidatesTokenCount: 300,
        cachedContentTokenCount: 200,
        thoughtsTokenCount: 80,
        totalTokenCount: 1580,
      },
    },
  ],
  expected: {
    input: 1000, // 1200 prompt - 200 cached
    output: 380, // 300 candidates + 80 thoughts
    cacheWrite: 0,
    cacheRead: 200,
    reasoning: 80,
    complete: true,
  },
  reportedPromptCount: 1200,
};

/** Every provider fixture, driving the parameterised contract suite. */
export const fixtures: AdapterFixture[] = [anthropicFixture, openaiFixture, geminiFixture];
