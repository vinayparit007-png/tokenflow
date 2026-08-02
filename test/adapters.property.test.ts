import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { fixtures } from "./fixtures/index.js";
import { replay } from "./util.js";

/**
 * Build an arbitrary that takes a fixture's events and returns them reordered
 * AND with each event duplicated 1..3 times — the two perturbations a correct
 * absolute-total adapter must be immune to.
 *
 * The shuffle is done by pairing each (expanded) event with a random sort key,
 * which yields a reproducible permutation without needing a stateful RNG.
 */
function shuffledWithDuplicates(events: unknown[]) {
  return fc
    .array(fc.integer({ min: 1, max: 3 }), { minLength: events.length, maxLength: events.length })
    .chain((dupCounts) => {
      const expanded = events.flatMap((event, i) => Array<unknown>(dupCounts[i]!).fill(event));
      return fc
        .array(fc.integer(), { minLength: expanded.length, maxLength: expanded.length })
        .map((keys) =>
          expanded
            .map((event, i) => ({ event, key: keys[i]! }))
            .sort((a, b) => a.key - b.key)
            .map((x) => x.event),
        );
    });
}

describe("adapter property: order and duplication don't change final totals", () => {
  for (const fx of fixtures) {
    it(`${fx.provider}: any permutation with duplicates equals the canonical replay`, () => {
      const canonical = replay(fx.adapter, fx.events);
      fc.assert(
        fc.property(shuffledWithDuplicates(fx.events), (perturbed) => {
          expect(replay(fx.adapter, perturbed)).toEqual(canonical);
        }),
        { numRuns: 300 },
      );
    });
  }
});
