import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { SessionCost } from "../src/session.js";
import { parsePricing, type PricingTable } from "../src/pricing/loader.js";
import type { Usage } from "../src/usage.js";

/** A pricing table with two priced models used across the deterministic tests. */
const pricing: PricingTable = parsePricing({
  updated: "2026-08-02",
  providers: {
    anthropic: {
      source: "u",
      models: { opus: { input: 3000, output: 15000, cacheWrite: 3750, cacheRead: 300 } },
    },
    openai: {
      source: "u",
      models: { gpt: { input: 2500, output: 10000, cacheWrite: 0, cacheRead: 1250 } },
    },
  },
});

function usage(partial: Partial<Usage>): Usage {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, reasoning: 0, complete: true, ...partial };
}

describe("SessionCost aggregation", () => {
  it("sums usage per model and totals the session", () => {
    const s = new SessionCost(pricing);
    s.record("anthropic", "opus", usage({ input: 1000, output: 300 }));
    s.record("anthropic", "opus", usage({ input: 500, output: 100 }));
    s.record("openai", "gpt", usage({ input: 200, output: 50 }));

    const byModel = s.byModel();
    const opus = byModel.find((m) => m.model === "opus")!;
    expect(opus.turns).toBe(2);
    expect(opus.usage.input).toBe(1500);
    expect(opus.usage.output).toBe(400);

    // Sum of per-model costs equals the session total.
    const summed = byModel.reduce((acc, m) => acc + (m.cost ?? 0n), 0n);
    expect(s.total()).toBe(summed);
  });

  it("propagates null: any unpriced turn makes the total unknown", () => {
    const s = new SessionCost(pricing);
    s.record("anthropic", "opus", usage({ input: 1000, output: 300 }));
    s.record("anthropic", "unknown-model", usage({ input: 100, output: 20 }));

    expect(s.total()).toBeNull();
    expect(s.unpricedModels()).toEqual(["anthropic:unknown-model"]);
    // The priced model still reports its own cost in the breakdown.
    expect(s.byModel().find((m) => m.model === "opus")!.cost).not.toBeNull();
    expect(s.byModel().find((m) => m.model === "unknown-model")!.cost).toBeNull();
  });

  it("sums cache savings over priced turns only (does not collapse to null)", () => {
    const s = new SessionCost(pricing);
    s.record("anthropic", "opus", usage({ input: 100, cacheRead: 200 })); // 200*(3000-300)=540000
    s.record("anthropic", "unknown-model", usage({ input: 100, cacheRead: 999 })); // skipped
    expect(s.cacheSavings()).toBe(540_000n);
  });
});

describe("SessionCost properties", () => {
  const models = [
    { provider: "anthropic", model: "opus" },
    { provider: "openai", model: "gpt" },
  ] as const;

  const arbTurn = fc
    .record({
      pick: fc.integer({ min: 0, max: models.length - 1 }),
      input: fc.nat({ max: 100_000 }),
      output: fc.nat({ max: 100_000 }),
      cacheWrite: fc.nat({ max: 100_000 }),
      cacheRead: fc.nat({ max: 100_000 }),
      reasoningFrac: fc.nat({ max: 100 }),
    })
    .map((r) => ({
      ...models[r.pick]!,
      usage: usage({
        input: r.input,
        output: r.output,
        cacheWrite: r.cacheWrite,
        cacheRead: r.cacheRead,
        reasoning: Math.floor((r.output * r.reasoningFrac) / 100), // subset of output
      }),
    }));

  it("total is monotonically non-decreasing as turns are recorded", () => {
    fc.assert(
      fc.property(fc.array(arbTurn, { maxLength: 40 }), (turns) => {
        const s = new SessionCost(pricing);
        let prev = 0n;
        for (const t of turns) {
          s.record(t.provider, t.model, t.usage);
          const total = s.total()!; // all models here are priced
          expect(total).toBeGreaterThanOrEqual(prev);
          prev = total;
        }
      }),
    );
  });

  it("session total equals the sum of per-model costs (all priced)", () => {
    fc.assert(
      fc.property(fc.array(arbTurn, { maxLength: 40 }), (turns) => {
        const s = new SessionCost(pricing);
        for (const t of turns) s.record(t.provider, t.model, t.usage);
        const summed = s.byModel().reduce((acc, m) => acc + (m.cost ?? 0n), 0n);
        expect(s.total()).toBe(summed);
      }),
    );
  });
});
