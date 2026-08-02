import type { Usage } from "../usage.js";
import type { ModelRates } from "../pricing/loader.js";
import { costOf } from "../cost.js";
import { formatNanoUSD } from "../format.js";
import type { Terminal } from "./tty.js";

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

/**
 * Renders the live cost line to the terminal and snaps it to truth on completion.
 *
 * In a TTY the estimate is drawn on stderr in place (`\r` + clear-line), so it
 * never pollutes the piped stdout stream; when the turn ends the estimate line is
 * cleared and the final, exact cost is written through the chokepoint (stdout in a
 * TTY, stderr when piped). When not a TTY there is no live line at all.
 */
export class LiveCostLine {
  private readonly estimator: CostEstimator;

  constructor(
    private readonly terminal: Terminal,
    rates: ModelRates | null,
    private readonly modelLabel: string,
  ) {
    this.estimator = new CostEstimator(rates);
  }

  onText(text: string): void {
    this.estimator.addChars(text.length);
    this.draw();
  }

  onUsage(usage: Usage): void {
    this.estimator.setInputFrom(usage);
    this.draw();
  }

  private draw(): void {
    if (!this.terminal.isTTY) return;
    const { nanodollars } = this.estimator.estimate();
    const text = nanodollars === null ? "~?" : `~${formatNanoUSD(nanodollars)}`;
    this.terminal.err(`\r\x1b[2K${this.terminal.c.dim(`${this.modelLabel} ${text}`)}`);
  }

  /** Clear the estimate line and print the final, exact cost. Returns it. */
  finalize(usage: Usage): CostSnapshot {
    if (this.terminal.isTTY) this.terminal.err("\r\x1b[2K");
    const snapshot = this.estimator.actual(usage);
    return snapshot;
  }

  /** Estimated output tokens at this moment, for drift logging. */
  estimatedOutputTokens(): number {
    return estimateOutputTokens(this.estimator.charsSeen());
  }
}
