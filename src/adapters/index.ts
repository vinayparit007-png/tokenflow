import type { Usage } from "../usage.js";
import { adaptAnthropic, type AnthropicEvent } from "./anthropic.js";
import { adaptOpenAI, type OpenAIEvent } from "./openai.js";
import { adaptGemini, type GeminiEvent } from "./gemini.js";

export type { UsagePatch } from "./merge.js";
export { mergeUsage } from "./merge.js";
export { adaptAnthropic, type AnthropicEvent, type AnthropicUsage } from "./anthropic.js";
export { adaptOpenAI, type OpenAIEvent, type OpenAIUsage } from "./openai.js";
export { adaptGemini, type GeminiEvent, type GeminiUsageMetadata } from "./gemini.js";

/** Canonical provider identifiers used as keys everywhere (pricing, config, CLI). */
export type ProviderName = "anthropic" | "openai" | "gemini";

/**
 * A provider adapter is a pure event reducer: `(usage, event) => usage`. It
 * assigns absolute totals and never accumulates, so replaying an event stream —
 * duplicated or reordered — yields identical totals. This interface is what the
 * contract suite parameterises over.
 */
export interface ProviderAdapter<E = unknown> {
  readonly provider: ProviderName;
  readonly adapt: (usage: Usage, event: E) => Usage;
}

export const anthropicAdapter: ProviderAdapter<AnthropicEvent> = {
  provider: "anthropic",
  adapt: adaptAnthropic,
};

export const openaiAdapter: ProviderAdapter<OpenAIEvent> = {
  provider: "openai",
  adapt: adaptOpenAI,
};

export const geminiAdapter: ProviderAdapter<GeminiEvent> = {
  provider: "gemini",
  adapt: adaptGemini,
};

/** Lookup table of every adapter, keyed by provider name. */
export const adapters: Record<ProviderName, ProviderAdapter> = {
  anthropic: anthropicAdapter as ProviderAdapter,
  openai: openaiAdapter as ProviderAdapter,
  gemini: geminiAdapter as ProviderAdapter,
};
