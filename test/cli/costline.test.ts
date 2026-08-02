import { describe, it, expect } from "vitest";
import { CostEstimator, estimateOutputTokens, CHARS_PER_TOKEN } from "../../src/cli/costline.js";
import { DriftLogger } from "../../src/cli/drift.js";
import type { ModelRates } from "../../src/pricing/loader.js";
import type { Usage } from "../../src/usage.js";

const rates: ModelRates = { input: 3000n, output: 15000n, cacheWrite: 3750n, cacheRead: 300n };

function usage(p: Partial<Usage>): Usage {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, reasoning: 0, complete: true, ...p };
}

describe("estimateOutputTokens", () => {
  it("uses ~3.7 chars per token", () => {
    expect(estimateOutputTokens(37)).toBe(Math.round(37 / CHARS_PER_TOKEN));
    expect(estimateOutputTokens(0)).toBe(0);
  });
});

describe("CostEstimator", () => {
  it("keeps input exact and estimates output from characters", () => {
    const est = new CostEstimator(rates);
    est.setInputFrom(usage({ input: 1000, cacheRead: 200 }));
    est.addChars(370); // ~100 tokens
    const snap = est.estimate();
    // input: 1000*3000 + 200*300 = 3,060,000 ; output est: 100*15000 = 1,500,000
    expect(snap.estimated).toBe(true);
    expect(snap.nanodollars).toBe(3_060_000n + BigInt(estimateOutputTokens(370)) * 15000n);
  });

  it("snaps to the exact cost on completion", () => {
    const est = new CostEstimator(rates);
    const final = usage({ input: 1000, output: 300, cacheRead: 200 });
    const snap = est.actual(final);
    expect(snap.estimated).toBe(false);
    // 1000*3000 + 300*15000 + 200*300 = 7,560,000
    expect(snap.nanodollars).toBe(7_560_000n);
  });

  it("returns null (never 0) for an unpriced model", () => {
    const est = new CostEstimator(null);
    est.addChars(1000);
    expect(est.estimate().nanodollars).toBeNull();
    expect(est.actual(usage({ output: 50 })).nanodollars).toBeNull();
  });
});

describe("DriftLogger", () => {
  it("records estimate-vs-actual with a ratio", () => {
    const lines: string[] = [];
    const logger = new DriftLogger((line) => lines.push(line));
    const entry = logger.record("claude-opus-4-8", 100, 120);
    expect(entry.ratio).toBeCloseTo(1.2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ model: "claude-opus-4-8", estimatedOutputTokens: 100, actualOutputTokens: 120 });
  });

  it("uses null ratio when the estimate was zero", () => {
    const logger = new DriftLogger(() => {});
    expect(logger.record("m", 0, 10).ratio).toBeNull();
  });
});
