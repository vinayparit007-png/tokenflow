import { describe, it, expect } from "vitest";
import { assertUsageInvariants } from "../src/usage.js";
import { fixtures } from "./fixtures/index.js";
import { replay } from "./util.js";

/**
 * THE CONTRACT. This one parameterised suite is the spec for the normalised
 * `Usage` type. Every provider adapter must satisfy it identically; a new
 * provider is "done" when it passes here.
 */
describe.each(fixtures)("adapter contract: $provider", (fx) => {
  it(`produces exact totals (${fx.description})`, () => {
    expect(replay(fx.adapter, fx.events)).toEqual(fx.expected);
  });

  it("keeps input and cacheRead disjoint and covering the prompt count", () => {
    const usage = replay(fx.adapter, fx.events);
    // Decision 5: cache-read tokens are billed once. Their sum with fresh input
    // must equal exactly what the provider reported as its prompt size.
    expect(usage.input + usage.cacheRead).toBe(fx.reportedPromptCount);
    expect(usage.input).toBeGreaterThanOrEqual(0);
    expect(usage.cacheRead).toBeGreaterThanOrEqual(0);
  });

  it("keeps reasoning a subset of output", () => {
    const usage = replay(fx.adapter, fx.events);
    expect(usage.reasoning).toBeLessThanOrEqual(usage.output);
  });

  it("marks the turn complete once the stream ends", () => {
    expect(replay(fx.adapter, fx.events).complete).toBe(true);
  });

  it("yields a usage object that passes the invariant assertion", () => {
    expect(() => assertUsageInvariants(replay(fx.adapter, fx.events))).not.toThrow();
  });
});
