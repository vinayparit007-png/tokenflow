import { describe, it, expect } from "vitest";
import { costOf, cacheSavingsOf } from "../src/cost.js";
import type { ModelRates } from "../src/pricing/loader.js";
import type { Usage } from "../src/usage.js";

const rates: ModelRates = {
  input: 3000n, // $3 / M tokens
  output: 15000n, // $15 / M tokens
  cacheWrite: 3750n,
  cacheRead: 300n,
};

const usage: Usage = {
  input: 1000,
  output: 300,
  cacheWrite: 50,
  cacheRead: 200,
  reasoning: 80,
  complete: true,
};

describe("costOf", () => {
  it("sums each token class at its own rate, in exact nanodollars", () => {
    // 1000*3000 + 300*15000 + 50*3750 + 200*300
    expect(costOf(usage, rates)).toBe(7_747_500n);
  });

  it("does not bill reasoning separately (it is already part of output)", () => {
    const withReasoning = costOf(usage, rates);
    const noReasoning = costOf({ ...usage, reasoning: 0 }, rates);
    expect(withReasoning).toBe(noReasoning);
  });

  it("returns null for an unpriced model rather than a wrong 0", () => {
    expect(costOf(usage, null)).toBeNull();
  });

  it("throws on an impossible usage (cached tokens exceeded prompt)", () => {
    expect(() => costOf({ ...usage, input: -5 }, rates)).toThrow();
  });
});

describe("cacheSavingsOf", () => {
  it("values cache reads at the input-vs-cacheRead rate gap", () => {
    // 200 cacheRead * (3000 - 300)
    expect(cacheSavingsOf(usage, rates)).toBe(540_000n);
  });

  it("returns null when the model is unpriced", () => {
    expect(cacheSavingsOf(usage, null)).toBeNull();
  });
});
