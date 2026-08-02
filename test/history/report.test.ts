import { describe, it, expect } from "vitest";
import { parseSince, byModel, byDay, total } from "../../src/history/report.js";
import type { TurnCostRow } from "../../src/history/store.js";

const rows: TurnCostRow[] = [
  { createdAt: "2026-08-01T09:00:00Z", model: "claude-opus-4-8", cost: 1000n },
  { createdAt: "2026-08-01T18:00:00Z", model: "gpt-4o", cost: 500n },
  { createdAt: "2026-08-02T10:00:00Z", model: "claude-opus-4-8", cost: 2000n },
];

describe("parseSince", () => {
  const now = new Date("2026-08-10T00:00:00Z");
  it("parses h/d/w suffixes and bare-number days", () => {
    expect(parseSince("24h", now).toISOString()).toBe("2026-08-09T00:00:00.000Z");
    expect(parseSince("7d", now).toISOString()).toBe("2026-08-03T00:00:00.000Z");
    expect(parseSince("2w", now).toISOString()).toBe("2026-07-27T00:00:00.000Z");
    expect(parseSince("3", now).toISOString()).toBe("2026-08-07T00:00:00.000Z");
  });
  it("throws on garbage", () => {
    expect(() => parseSince("soon")).toThrow(/Invalid --since/);
  });
});

describe("aggregation", () => {
  it("groups by model", () => {
    expect(byModel(rows)).toEqual([
      { key: "claude-opus-4-8", turns: 2, cost: 3000n },
      { key: "gpt-4o", turns: 1, cost: 500n },
    ]);
  });

  it("groups by day", () => {
    expect(byDay(rows)).toEqual([
      { key: "2026-08-01", turns: 2, cost: 1500n },
      { key: "2026-08-02", turns: 1, cost: 2000n },
    ]);
  });

  it("totals everything", () => {
    expect(total(rows)).toBe(3500n);
  });

  it("propagates null when a bucket has an unpriced turn", () => {
    const withNull: TurnCostRow[] = [...rows, { createdAt: "2026-08-02T11:00:00Z", model: "gpt-4o", cost: null }];
    expect(byModel(withNull).find((b) => b.key === "gpt-4o")!.cost).toBeNull();
    expect(total(withNull)).toBeNull();
  });
});
