import { describe, it, expect } from "vitest";
import { parsePricing, loadPricing } from "../src/pricing/loader.js";

const valid = {
  updated: "2026-08-02",
  providers: {
    anthropic: {
      source: "https://example.com",
      models: {
        "claude-x": { input: 3000, output: 15000, cacheWrite: 3750, cacheRead: 300 },
      },
    },
  },
};

describe("parsePricing", () => {
  it("loads rates as bigint and looks them up by provider/model", () => {
    const table = parsePricing(valid);
    const rates = table.rates("anthropic", "claude-x");
    expect(rates).toEqual({ input: 3000n, output: 15000n, cacheWrite: 3750n, cacheRead: 300n });
    expect(table.updated).toBe("2026-08-02");
    expect(table.sources.anthropic).toBe("https://example.com");
  });

  it("returns null for unknown provider or model (null must propagate)", () => {
    const table = parsePricing(valid);
    expect(table.rates("anthropic", "nope")).toBeNull();
    expect(table.rates("nope", "claude-x")).toBeNull();
  });

  it.each([
    ["bad date", { ...valid, updated: "August 2026" }],
    ["missing providers", { updated: "2026-08-02" }],
    [
      "negative rate",
      {
        updated: "2026-08-02",
        providers: { p: { source: "u", models: { m: { input: -1, output: 0, cacheWrite: 0, cacheRead: 0 } } } },
      },
    ],
    [
      "non-integer rate",
      {
        updated: "2026-08-02",
        providers: { p: { source: "u", models: { m: { input: 1.5, output: 0, cacheWrite: 0, cacheRead: 0 } } } },
      },
    ],
    [
      "missing rate field",
      {
        updated: "2026-08-02",
        providers: { p: { source: "u", models: { m: { input: 0, output: 0, cacheWrite: 0 } } } },
      },
    ],
  ])("throws an actionable error on %s", (_name, bad) => {
    expect(() => parsePricing(bad)).toThrow(/Invalid pricing file/);
  });
});

describe("loadPricing (bundled file)", () => {
  it("loads the shipped pricing.json and exposes known models", () => {
    const table = loadPricing();
    // Placeholder rates are 0 for now (TODO in pricing.json) but the model exists.
    expect(table.rates("anthropic", "claude-opus-4-8")).not.toBeNull();
    expect(table.rates("openai", "gpt-4o")).not.toBeNull();
    expect(table.rates("gemini", "gemini-2.5-pro")).not.toBeNull();
  });
});
