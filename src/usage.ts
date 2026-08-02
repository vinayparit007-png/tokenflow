/**
 * The single normalised token-accounting shape that every provider adapter
 * reduces to. This type is the contract: the parameterised contract test suite
 * (`test/adapters.contract.test.ts`) enforces it against all three providers.
 *
 * Why these exact fields — and why `input` and `cacheRead` are kept disjoint:
 * providers disagree on whether cache-read tokens live *inside* the prompt count
 * (OpenAI, Gemini) or *beside* it (Anthropic). Normalising to disjoint fields is
 * what lets the cost engine bill each token at exactly one rate. Billing the same
 * token at two rates is the specific bug this shape exists to prevent.
 */
export interface Usage {
  /** Fresh prompt tokens. Cache-read tokens are EXCLUDED (they live in `cacheRead`). */
  input: number;
  /** Generated tokens. Includes reasoning tokens — do not add `reasoning` on top when billing. */
  output: number;
  /** Tokens written to the provider's cache on this request. */
  cacheWrite: number;
  /** Tokens served from cache instead of being freshly processed. */
  cacheRead: number;
  /** Reasoning/thinking tokens. A display-only subset of `output`, never billed separately. */
  reasoning: number;
  /** True once the provider has sent its final, authoritative counts. */
  complete: boolean;
}

/**
 * The identity element for usage reduction. Every adapter fold starts here so
 * that an empty event stream yields a well-formed, all-zero `Usage` rather than
 * `undefined` leaking into the cost engine.
 */
export function emptyUsage(): Usage {
  return {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    reasoning: 0,
    complete: false,
  };
}

/**
 * Fail loud on a usage object that violates the normalisation contract, so that
 * a provider wire-format surprise (e.g. cached tokens exceeding the prompt count,
 * which would make `input` negative) surfaces as an error here rather than as a
 * silently wrong bill downstream. Called at the boundary of the cost engine.
 */
export function assertUsageInvariants(usage: Usage): void {
  const fields: Array<[keyof Usage, number]> = [
    ["input", usage.input],
    ["output", usage.output],
    ["cacheWrite", usage.cacheWrite],
    ["cacheRead", usage.cacheRead],
    ["reasoning", usage.reasoning],
  ];
  for (const [name, value] of fields) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(
        `Usage.${name} must be a non-negative finite number, got ${value}. ` +
          `This usually means a provider reported cached tokens larger than its prompt count.`,
      );
    }
  }
  if (usage.reasoning > usage.output) {
    throw new Error(
      `Usage.reasoning (${usage.reasoning}) exceeds Usage.output (${usage.output}); ` +
        `reasoning must be a subset of output.`,
    );
  }
}
