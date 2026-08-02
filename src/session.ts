import type { Usage } from "./usage.js";
import type { PricingTable, ModelRates } from "./pricing/loader.js";
import { costOf, cacheSavingsOf } from "./cost.js";

/** One recorded turn: which model answered, and what it cost in tokens. */
export interface Turn {
  provider: string;
  model: string;
  usage: Usage;
}

/** Aggregated figures for a single model across all its turns in a session. */
export interface ModelAggregate {
  provider: string;
  model: string;
  turns: number;
  usage: Usage;
  /** Total cost for this model, or `null` if the model is unpriced. */
  cost: bigint | null;
  /** Cache savings for this model, or `null` if unpriced. */
  cacheSavings: bigint | null;
}

/** A model key of the form `provider:model`, used to group turns. */
function keyOf(provider: string, model: string): string {
  return `${provider}:${model}`;
}

/**
 * Accumulates the cost of a session across many turns and models.
 *
 * The null-propagation rule (decision 3) is the reason this is a class and not a
 * one-line sum: if *any* turn used a model missing from the pricing table, the
 * session total is `null` and the report shows `?`, not a total that quietly
 * omits the unpriced turns. `unpricedModels()` names the offenders so the display
 * can explain the `?`.
 */
export class SessionCost {
  private readonly turns: Turn[] = [];

  constructor(private readonly pricing: PricingTable) {}

  /** Rates for a turn's model, or null if unpriced. */
  private ratesFor(turn: Turn): ModelRates | null {
    return this.pricing.rates(turn.provider, turn.model);
  }

  /** Record one completed turn. */
  record(provider: string, model: string, usage: Usage): void {
    this.turns.push({ provider, model, usage });
  }

  /** Every turn recorded so far, in order. */
  allTurns(): readonly Turn[] {
    return this.turns;
  }

  /**
   * Aggregate usage and cost per model. Across *distinct* turns token counts add
   * (each turn is a separate request), so usage is summed field-wise here — this
   * is unrelated to the max-merge used *within* a single turn's event stream.
   */
  byModel(): ModelAggregate[] {
    const groups = new Map<string, ModelAggregate>();
    for (const turn of this.turns) {
      const key = keyOf(turn.provider, turn.model);
      const existing = groups.get(key);
      if (existing) {
        existing.turns += 1;
        existing.usage = addUsage(existing.usage, turn.usage);
      } else {
        groups.set(key, {
          provider: turn.provider,
          model: turn.model,
          turns: 1,
          usage: { ...turn.usage },
          cost: null,
          cacheSavings: null,
        });
      }
    }
    // Cost the summed usage once per model (rates are linear, so costing the sum
    // equals summing per-turn costs — and it keeps per-model rounding trivial).
    for (const agg of groups.values()) {
      const rates = this.pricing.rates(agg.provider, agg.model);
      agg.cost = costOf(agg.usage, rates);
      agg.cacheSavings = cacheSavingsOf(agg.usage, rates);
    }
    return [...groups.values()];
  }

  /** Provider:model pairs that have no entry in the pricing table. */
  unpricedModels(): string[] {
    const seen = new Set<string>();
    for (const turn of this.turns) {
      if (this.ratesFor(turn) === null) seen.add(keyOf(turn.provider, turn.model));
    }
    return [...seen];
  }

  /**
   * Session total in nanodollars, or `null` if any turn used an unpriced model.
   * Null wins: one unknown price makes the whole total unknown.
   */
  total(): bigint | null {
    let sum = 0n;
    for (const turn of this.turns) {
      const cost = costOf(turn.usage, this.ratesFor(turn));
      if (cost === null) return null;
      sum += cost;
    }
    return sum;
  }

  /**
   * Total cache savings across priced turns, in nanodollars. Unpriced turns
   * contribute nothing (their savings are unknowable), so unlike `total()` this
   * does not collapse to null — it reports what is known.
   */
  cacheSavings(): bigint {
    let sum = 0n;
    for (const turn of this.turns) {
      const saved = cacheSavingsOf(turn.usage, this.ratesFor(turn));
      if (saved !== null) sum += saved;
    }
    return sum;
  }
}

/** Field-wise sum of two usage records (distinct requests add). */
function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
    reasoning: a.reasoning + b.reasoning,
    complete: a.complete && b.complete,
  };
}
