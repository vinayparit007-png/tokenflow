import type { Usage } from "../usage.js";

/**
 * A partial, provider-agnostic view of an event's usage numbers. Adapters
 * translate their provider's wire shape into this before merging.
 */
export interface UsagePatch {
  input?: number;
  output?: number;
  cacheWrite?: number;
  cacheRead?: number;
  reasoning?: number;
  complete?: boolean;
}

/**
 * Fold a patch into a running `Usage` by taking the per-field high-water mark.
 *
 * Why max-merge rather than plain last-write assignment (see the note in the
 * Phase 1 summary): providers stream *cumulative absolute* running totals, not
 * increments. Decision 1 rules out `+=` because it double-counts re-sent events.
 * But plain assignment ("last write wins") is not order-independent — Anthropic's
 * `message_start` reports `output_tokens: 1` while the later `message_delta`
 * reports the final total, so replaying those two events in the other order would
 * clobber the real total with 1. Taking the max of absolute totals is still an
 * absolute assignment (never an increment), and it makes the result invariant to
 * BOTH duplication and reordering — exactly the two properties the spec requires.
 * It is safe because token counts within a single request are monotonic.
 *
 * A field absent from the patch leaves the running value untouched, so an event
 * that only carries `output` never resets `input` to zero.
 */
export function mergeUsage(usage: Usage, patch: UsagePatch): Usage {
  const next: Usage = { ...usage };
  if (patch.input !== undefined) next.input = Math.max(next.input, patch.input);
  if (patch.output !== undefined) next.output = Math.max(next.output, patch.output);
  if (patch.cacheWrite !== undefined) next.cacheWrite = Math.max(next.cacheWrite, patch.cacheWrite);
  if (patch.cacheRead !== undefined) next.cacheRead = Math.max(next.cacheRead, patch.cacheRead);
  if (patch.reasoning !== undefined) next.reasoning = Math.max(next.reasoning, patch.reasoning);
  if (patch.complete) next.complete = true;
  return next;
}
