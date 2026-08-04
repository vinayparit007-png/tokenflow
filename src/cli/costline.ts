import type { Usage } from "../usage.js";
import type { ModelRates } from "../pricing/loader.js";
import { costOf } from "../cost.js";

/** Rough tokens-per-character used to estimate output cost before the provider
 * reports real counts. ~3.7 chars/token is a decent cross-model average. */
export const CHARS_PER_TOKEN = 3.7;

/** Estimate output tokens from a character count. */
export function estimateOutputTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

/** The result of an estimate: a value (or null if unpriced) and whether it is a
 * guess (estimated) or the provider's final truth. */
export interface CostSnapshot {
  nanodollars: bigint | null;
  estimated: boolean;
}

/**
 * Tracks the running cost of a single turn while it streams.
 *
 * The brief's model: input cost is EXACT from the moment the provider reports
 * prompt tokens; output cost is ESTIMATED from characters received (rendered as
 * `~$…`, dimmed) until the final usage arrives, then SNAPPED to truth. Keeping
 * input exact and only estimating output means the live number is never wildly
 * off — the uncertain part is bounded to the not-yet-final generation.
 */
export class CostEstimator {
  private chars = 0;
  private knownInputCost: bigint | null = null;

  constructor(private readonly rates: ModelRates | null) {}

  /** Record generated characters seen so far (drives the output estimate). */
  addChars(count: number): void {
    this.chars += count;
  }

  /** Lock in the exact input-side cost once prompt/cache tokens are known. */
  setInputFrom(usage: Usage): void {
    if (this.rates === null) return;
    this.knownInputCost =
      BigInt(usage.input) * this.rates.input +
      BigInt(usage.cacheWrite) * this.rates.cacheWrite +
      BigInt(usage.cacheRead) * this.rates.cacheRead;
  }

  /** The current best estimate: exact input + character-estimated output. */
  estimate(): CostSnapshot {
    if (this.rates === null) return { nanodollars: null, estimated: true };
    const estOutput = BigInt(estimateOutputTokens(this.chars)) * this.rates.output;
    return { nanodollars: (this.knownInputCost ?? 0n) + estOutput, estimated: true };
  }

  /** The provider's authoritative cost once the turn is complete. */
  actual(usage: Usage): CostSnapshot {
    return { nanodollars: costOf(usage, this.rates), estimated: false };
  }

  /** Characters counted so far (for drift logging). */
  charsSeen(): number {
    return this.chars;
  }
}

// NOTE ON A REMOVED FEATURE: an earlier version of this module also included a
// `LiveCostLine` class that redrew a running "~$0.00003" estimate onto the
// terminal in place on every streamed chunk, using `\r` + clear-line on stderr.
// That assumed it owned the last line of the screen — which broke the moment
// the model's actual multi-line response ALSO streamed to stdout at the same
// time: the two writes race, and the estimate text gets glued onto the front of
// content lines instead of staying put. Rather than fight per-terminal ANSI
// scroll-region tricks (this project deliberately has no TUI framework), the
// live in-place redraw was removed. `CostEstimator` above still tracks
// characters as they stream — that data still feeds the drift log used to
// calibrate the chars-per-token estimate — it just no longer draws anything
// mid-stream. The only cost line shown is the single exact one printed once the
// turn completes (see `formatCostLine` in run.ts).
