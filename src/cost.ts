import type { Usage } from "./usage.js";
import { assertUsageInvariants } from "./usage.js";
import type { ModelRates } from "./pricing/loader.js";

/**
 * Compute the cost of one usage record in integer nanodollars.
 *
 * Why `bigint` and why `null`:
 * - All arithmetic is `bigint` so a long session never accumulates float drift
 *   (decision 2). Rates are whole nanodollars-per-token, counts are whole tokens,
 *   so every product and sum is exact.
 * - `rates === null` (an unpriced model) yields `null`, not `0`. A missing price
 *   is unknown, not free; returning 0 would report a confidently-wrong bill
 *   (decision 3). The caller is responsible for propagating the null.
 *
 * `reasoning` is deliberately not billed: it is already a subset of `output`, so
 * charging it again would double-count thinking tokens.
 */
export function costOf(usage: Usage, rates: ModelRates | null): bigint | null {
  if (rates === null) return null;
  assertUsageInvariants(usage);
  return (
    BigInt(usage.input) * rates.input +
    BigInt(usage.output) * rates.output +
    BigInt(usage.cacheWrite) * rates.cacheWrite +
    BigInt(usage.cacheRead) * rates.cacheRead
  );
}

/**
 * How much cache reads saved on this request, in nanodollars: the difference
 * between billing the cache-read tokens at the full input rate versus the
 * (cheaper) cache-read rate. Returns `null` when the model is unpriced.
 */
export function cacheSavingsOf(usage: Usage, rates: ModelRates | null): bigint | null {
  if (rates === null) return null;
  const delta = rates.input - rates.cacheRead;
  return BigInt(usage.cacheRead) * delta;
}
