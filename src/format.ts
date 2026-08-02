/**
 * Formatting lives at the display boundary and nowhere else (decision 2): every
 * amount stays an integer `bigint` of nanodollars right up until it is shown.
 */

/** 1 US dollar expressed in nanodollars. */
const NANO_PER_DOLLAR = 1_000_000_000n;
/** 1 US cent expressed in nanodollars. */
const NANO_PER_CENT = 10_000_000n;

/**
 * Render a nanodollar amount as a `$`-prefixed decimal string, choosing decimal
 * places by magnitude so small costs stay legible and large ones stay tidy:
 *   - under a cent  -> 5 dp  ($0.00042)
 *   - under a dollar -> 4 dp ($0.0731)
 *   - a dollar or more -> 2 dp ($12.40)
 *
 * Why bespoke bigint formatting instead of `Number(x) / 1e9`: converting to a
 * float to divide would reintroduce exactly the drift the nanodollar
 * representation exists to avoid. All rounding here is exact integer arithmetic.
 */
export function formatNanoUSD(nanodollars: bigint): string {
  const negative = nanodollars < 0n;
  const magnitude = negative ? -nanodollars : nanodollars;

  const decimals = magnitude < NANO_PER_CENT ? 5 : magnitude < NANO_PER_DOLLAR ? 4 : 2;

  // Round to `decimals` places using integer half-up: the smallest displayed
  // unit is 10^-decimals dollars = 10^(9-decimals) nanodollars.
  const unit = 10n ** BigInt(9 - decimals);
  const half = unit / 2n;
  const scaled = (magnitude + half) / unit; // number of displayed units

  const whole = scaled / 10n ** BigInt(decimals);
  const frac = scaled % 10n ** BigInt(decimals);
  const fracStr = frac.toString().padStart(decimals, "0");

  return `${negative ? "-" : ""}$${whole.toString()}.${fracStr}`;
}

/**
 * Display helper for costs that may be unknown. An unpriced model yields `null`
 * (decision 3) and is shown as `?` — never a confidently-wrong `$0.00`.
 */
export function formatCost(nanodollars: bigint | null): string {
  return nanodollars === null ? "?" : formatNanoUSD(nanodollars);
}
