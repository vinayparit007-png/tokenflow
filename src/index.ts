/**
 * Public API surface for the TokenFlow core (Phase 1). The CLI, providers, and
 * history layers in later phases build on exactly these exports.
 */
export type { Usage } from "./usage.js";
export { emptyUsage, assertUsageInvariants } from "./usage.js";

export type { ProviderName, ProviderAdapter, UsagePatch } from "./adapters/index.js";
export {
  adapters,
  anthropicAdapter,
  openaiAdapter,
  geminiAdapter,
  adaptAnthropic,
  adaptOpenAI,
  adaptGemini,
  mergeUsage,
} from "./adapters/index.js";
export type { AnthropicEvent, AnthropicUsage } from "./adapters/anthropic.js";
export type { OpenAIEvent, OpenAIUsage } from "./adapters/openai.js";
export type { GeminiEvent, GeminiUsageMetadata } from "./adapters/gemini.js";

export type { PricingTable, ModelRates } from "./pricing/loader.js";
export { loadPricing, loadPricingFrom, parsePricing } from "./pricing/loader.js";

export { costOf, cacheSavingsOf } from "./cost.js";

export type { Turn, ModelAggregate } from "./session.js";
export { SessionCost } from "./session.js";

export { formatNanoUSD, formatCost } from "./format.js";

export type {
  StoredTurn,
  SessionSummary,
  TurnMatch,
  TurnCostRow,
} from "./history/store.js";
export { HistoryStore, defaultDbPath, sanitizeFtsQuery } from "./history/store.js";
export type { CostBucket } from "./history/report.js";
export { parseSince, byModel, byDay, total } from "./history/report.js";

export type { Message, ChatRequest, StreamEvent, StreamOptions, Provider } from "./providers/index.js";
export {
  providers,
  getProvider,
  ProviderError,
  anthropicProvider,
  openaiProvider,
  geminiProvider,
  buildAnthropicRequest,
  buildOpenAIRequest,
  buildGeminiRequest,
  withRetry,
  abortableSleep,
  parseSSE,
  isAbortError,
  FixtureRecorder,
} from "./providers/index.js";
