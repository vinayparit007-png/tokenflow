import type { TurnCostRow } from "./store.js";

/**
 * Parse a relative duration like `7d`, `24h`, `2w`, or a bare number of days into
 * an absolute cutoff Date. A bad string throws so `cost --since garbage` fails
 * with a clear message rather than silently reporting everything.
 */
export function parseSince(spec: string, now: Date = new Date()): Date {
  const match = /^(\d+)([hdw]?)$/.exec(spec.trim());
  if (!match) {
    throw new Error(`Invalid --since value "${spec}". Use e.g. 24h, 7d, or 2w.`);
  }
  const amount = Number(match[1]);
  const unitMs = { h: 3_600_000, d: 86_400_000, w: 604_800_000, "": 86_400_000 }[match[2] ?? ""]!;
  return new Date(now.getTime() - amount * unitMs);
}

/** An aggregated spend bucket (a model or a day). */
export interface CostBucket {
  key: string;
  turns: number;
  /** Summed cost; null if any turn in the bucket was unpriced. */
  cost: bigint | null;
}

/** Sum rows into buckets by a key function, propagating null (decision 3). */
function bucketize(rows: TurnCostRow[], keyOf: (row: TurnCostRow) => string): CostBucket[] {
  const map = new Map<string, { turns: number; cost: bigint | null }>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = map.get(key) ?? { turns: 0, cost: 0n };
    bucket.turns += 1;
    if (row.cost === null || bucket.cost === null) bucket.cost = null;
    else bucket.cost += row.cost;
    map.set(key, bucket);
  }
  return [...map.entries()]
    .map(([key, b]) => ({ key, turns: b.turns, cost: b.cost }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

/** Spend grouped by model. */
export function byModel(rows: TurnCostRow[]): CostBucket[] {
  return bucketize(rows, (r) => r.model);
}

/** Spend grouped by calendar day (UTC, YYYY-MM-DD). */
export function byDay(rows: TurnCostRow[]): CostBucket[] {
  return bucketize(rows, (r) => r.createdAt.slice(0, 10));
}

/** Grand total across all rows, with null propagation. */
export function total(rows: TurnCostRow[]): bigint | null {
  let sum = 0n;
  for (const row of rows) {
    if (row.cost === null) return null;
    sum += row.cost;
  }
  return sum;
}
