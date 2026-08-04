import type { ProviderName } from "../adapters/index.js";
import type { Provider } from "./types.js";
import { anthropicProvider } from "./anthropic.js";
import { openaiProvider } from "./openai.js";
import { geminiProvider } from "./gemini.js";

export type { Message, ChatRequest, StreamEvent, StreamOptions, Provider } from "./types.js";
export { ProviderError } from "./types.js";
export { anthropicProvider, buildAnthropicRequest } from "./anthropic.js";
export { openaiProvider, buildOpenAIRequest } from "./openai.js";
export { geminiProvider, buildGeminiRequest } from "./gemini.js";
export { createOpenAICompatibleProvider } from "./custom.js";
export { withRetry, abortableSleep, type RetryOptions } from "./retry.js";
export { parseSSE } from "./sse.js";
export { FixtureRecorder, type RecordedFixture } from "./record.js";
export { isAbortError } from "./common.js";

/** Every provider client, keyed by canonical provider name. */
export const providers: Record<ProviderName, Provider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  gemini: geminiProvider,
};

/** Look up a provider client, throwing an actionable error for an unknown name. */
export function getProvider(name: string): Provider {
  const provider = providers[name as ProviderName];
  if (!provider) {
    throw new Error(
      `Unknown provider "${name}". Known providers: ${Object.keys(providers).join(", ")}.`,
    );
  }
  return provider;
}
