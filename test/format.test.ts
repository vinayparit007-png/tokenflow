import { describe, it, expect } from "vitest";
import { formatNanoUSD, formatCost } from "../src/format.js";

describe("formatNanoUSD: precision scales with magnitude", () => {
  it("uses 5 decimals under a cent", () => {
    expect(formatNanoUSD(420_000n)).toBe("$0.00042");
    expect(formatNanoUSD(0n)).toBe("$0.00000");
  });

  it("uses 4 decimals under a dollar", () => {
    expect(formatNanoUSD(73_100_000n)).toBe("$0.0731");
  });

  it("uses 2 decimals at a dollar or more", () => {
    expect(formatNanoUSD(12_400_000_000n)).toBe("$12.40");
  });

  it("rounds half-up at the chosen precision", () => {
    expect(formatNanoUSD(425_000n)).toBe("$0.00043"); // 42.5 -> 43
    expect(formatNanoUSD(12_405_000_000n)).toBe("$12.41"); // 1240.5 -> 1241
  });

  it("handles negative amounts (e.g. savings shown as a delta)", () => {
    expect(formatNanoUSD(-540_000n)).toBe("-$0.00054");
  });
});

describe("formatCost: unknown price shows ? not $0.00", () => {
  it("renders null as ?", () => {
    expect(formatCost(null)).toBe("?");
  });

  it("renders a known cost normally", () => {
    expect(formatCost(7_747_500n)).toBe("$0.00775");
  });
});
