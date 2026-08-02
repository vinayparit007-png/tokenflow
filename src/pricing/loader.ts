import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Per-token rates for one model, in nanodollars (1 dollar = 1e9 nanodollars).
 * Stored as `bigint` so the cost engine never touches floating point — the whole
 * point of the tool is numbers that don't drift.
 */
export interface ModelRates {
  input: bigint;
  output: bigint;
  cacheWrite: bigint;
  cacheRead: bigint;
}

/** A validated, queryable pricing table loaded from `pricing.json`. */
export interface PricingTable {
  /** ISO date the rates were last verified against provider docs. */
  readonly updated: string;
  /** Source URL per provider, so a user can check a rate before patching it. */
  readonly sources: Readonly<Record<string, string>>;
  /**
   * Look up a model's rates. Returns `null` for an unknown provider/model — and
   * null must propagate to the total (decision 3), never silently become 0.
   */
  rates(provider: string, model: string): ModelRates | null;
}

const RATE_FIELDS = ["input", "output", "cacheWrite", "cacheRead"] as const;

/** The raw JSON shape, before validation. */
interface RawPricing {
  updated?: unknown;
  providers?: Record<string, { source?: unknown; models?: Record<string, unknown> }>;
}

function fail(message: string): never {
  throw new Error(`Invalid pricing file: ${message}`);
}

/**
 * Parse and validate a pricing document. Throws an actionable error naming the
 * offending path if anything is malformed, because a wrong rate silently loaded
 * would corrupt every cost this tool reports.
 */
export function parsePricing(raw: unknown): PricingTable {
  if (typeof raw !== "object" || raw === null) fail("root must be an object.");
  const doc = raw as RawPricing;

  if (typeof doc.updated !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(doc.updated)) {
    fail(`"updated" must be an ISO date string (YYYY-MM-DD), got ${JSON.stringify(doc.updated)}.`);
  }
  if (typeof doc.providers !== "object" || doc.providers === null) {
    fail(`"providers" must be an object.`);
  }

  const sources: Record<string, string> = {};
  const table = new Map<string, Map<string, ModelRates>>();

  for (const [provider, block] of Object.entries(doc.providers)) {
    if (typeof block !== "object" || block === null) fail(`providers.${provider} must be an object.`);
    if (typeof block.source !== "string") fail(`providers.${provider}.source must be a URL string.`);
    if (typeof block.models !== "object" || block.models === null) {
      fail(`providers.${provider}.models must be an object.`);
    }
    sources[provider] = block.source;
    const models = new Map<string, ModelRates>();

    for (const [model, rawRates] of Object.entries(block.models)) {
      if (typeof rawRates !== "object" || rawRates === null) {
        fail(`providers.${provider}.models.${model} must be an object.`);
      }
      const r = rawRates as Record<string, unknown>;
      const rates = {} as ModelRates;
      for (const field of RATE_FIELDS) {
        const value = r[field];
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
          fail(
            `providers.${provider}.models.${model}.${field} must be a non-negative integer ` +
              `(nanodollars per token), got ${JSON.stringify(value)}.`,
          );
        }
        rates[field] = BigInt(value);
      }
      models.set(model, rates);
    }
    table.set(provider, models);
  }

  return {
    updated: doc.updated,
    sources,
    rates(provider, model) {
      return table.get(provider)?.get(model) ?? null;
    },
  };
}

/** Load and validate a pricing file from disk. */
export function loadPricingFrom(path: string): PricingTable {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`Could not read pricing file at ${path}: ${(cause as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new Error(`Pricing file at ${path} is not valid JSON: ${(cause as Error).message}`);
  }
  return parsePricing(json);
}

/** Load the pricing table bundled with the package. */
export function loadPricing(): PricingTable {
  const path = fileURLToPath(new URL("./pricing.json", import.meta.url));
  return loadPricingFrom(path);
}
