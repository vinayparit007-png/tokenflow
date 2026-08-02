import { describe, it, expect } from "vitest";
import { providers } from "../../src/providers/index.js";
import type { ProviderName } from "../../src/adapters/index.js";
import type { StreamEvent } from "../../src/providers/index.js";
import { assertUsageInvariants } from "../../src/usage.js";

/**
 * SHAPE-ONLY LIVE TEST — the mitigation for the one thing the fixture suite
 * cannot prove: that a provider hasn't changed its wire format. Frozen fixtures
 * will keep passing forever even if OpenAI renames `prompt_tokens` tomorrow; only
 * a real call catches that.
 *
 * It is gated behind TOKENFLOW_LIVE=1 plus the relevant API key, so it never runs
 * in the normal offline suite or on a contributor's machine without keys. CI runs
 * it nightly with secrets. It asserts SHAPE (a usage event arrives, is complete,
 * and satisfies the normalisation invariants), never exact token counts, which a
 * live model would never reproduce.
 */
const LIVE = process.env.TOKENFLOW_LIVE === "1";

const cases: Array<{ provider: ProviderName; model: string; keyEnv: string }> = [
  { provider: "anthropic", model: "claude-haiku-4-5", keyEnv: "ANTHROPIC_API_KEY" },
  { provider: "openai", model: "gpt-4o-mini", keyEnv: "OPENAI_API_KEY" },
  { provider: "gemini", model: "gemini-2.5-flash", keyEnv: "GEMINI_API_KEY" },
];

describe("live provider wire-format shape", () => {
  for (const { provider, model, keyEnv } of cases) {
    const enabled = LIVE && Boolean(process.env[keyEnv]);
    it.skipIf(!enabled)(`${provider}: still reports usage in the expected shape`, async () => {
      const events: StreamEvent[] = [];
      for await (const ev of providers[provider].stream(
        { model, messages: [{ role: "user", content: "Reply with the single word: ok" }], maxTokens: 16 },
        {},
      )) {
        events.push(ev);
      }

      const usageEvents = events.filter((e) => e.type === "usage") as Array<{ usage: import("../../src/usage.js").Usage }>;
      expect(usageEvents.length).toBeGreaterThan(0);

      const final = usageEvents.at(-1)!.usage;
      expect(final.complete).toBe(true);
      expect(final.input).toBeGreaterThan(0); // the prompt was counted
      expect(final.output).toBeGreaterThan(0); // something was generated
      expect(() => assertUsageInvariants(final)).not.toThrow(); // input/cacheRead disjoint, reasoning<=output
      expect(events.some((e) => e.type === "error")).toBe(false);
    }, 30_000);
  }
});
