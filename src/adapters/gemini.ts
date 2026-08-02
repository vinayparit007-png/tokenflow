import type { Usage } from "../usage.js";
import { mergeUsage } from "./merge.js";

/** Gemini's `usageMetadata`, present on streamed chunks (the final chunk carries
 * the authoritative totals). */
export interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  cachedContentTokenCount?: number;
  thoughtsTokenCount?: number;
}

/** A streamed Gemini `generateContent` chunk. */
export interface GeminiEvent {
  usageMetadata?: GeminiUsageMetadata;
  candidates?: Array<{ finishReason?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/**
 * Reduce one Gemini chunk into the running usage total.
 *
 * Why the subtraction and the addition:
 * - Like OpenAI, Gemini folds `cachedContentTokenCount` *inside*
 *   `promptTokenCount`, so we subtract to keep `input`/`cacheRead` disjoint.
 * - Gemini reports thinking tokens in a *separate* `thoughtsTokenCount` that is
 *   not included in `candidatesTokenCount`, yet both are billed as output. We add
 *   them so `output` reflects what is actually charged, and record the thinking
 *   portion in `reasoning` (a display-only subset of `output`).
 * Explicit cache creation is a separate API call in Gemini, so `cacheWrite` is 0.
 * Completion is signalled by a candidate carrying a `finishReason`.
 */
export function adaptGemini(usage: Usage, event: GeminiEvent): Usage {
  let next = usage;
  const m = event.usageMetadata;
  if (m) {
    const cached = m.cachedContentTokenCount ?? 0;
    const prompt = m.promptTokenCount ?? 0;
    const thoughts = m.thoughtsTokenCount ?? 0;
    const candidates = m.candidatesTokenCount ?? 0;
    next = mergeUsage(next, {
      input: prompt - cached,
      cacheRead: cached,
      output: candidates + thoughts,
      reasoning: thoughts,
      cacheWrite: 0,
    });
  }
  if (event.candidates?.some((c) => c.finishReason)) {
    next = mergeUsage(next, { complete: true });
  }
  return next;
}
