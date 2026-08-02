import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveModel } from "../../src/cli/config.js";
import { parsePricing } from "../../src/pricing/loader.js";

const pricing = parsePricing({
  updated: "2026-08-02",
  providers: {
    anthropic: { source: "u", models: { "claude-opus-4-8": { input: 1, output: 2, cacheWrite: 3, cacheRead: 0 } } },
    openai: { source: "u", models: { "gpt-4o-mini": { input: 1, output: 2, cacheWrite: 0, cacheRead: 0 } } },
  },
});

function tmpConfig(obj: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "tf-"));
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify(obj));
  return path;
}

describe("loadConfig", () => {
  it("returns {} when the file is absent", () => {
    expect(loadConfig(join(tmpdir(), "definitely-missing-xyz.json"))).toEqual({});
  });

  it("refuses a config with an inline API key", () => {
    const path = tmpConfig({ providers: { anthropic: { apiKey: "sk-secret" } } });
    expect(() => loadConfig(path)).toThrow(/inline API key/);
  });

  it("loads keyEnv references", () => {
    const path = tmpConfig({ providers: { anthropic: { keyEnv: "MY_KEY" } } });
    expect(loadConfig(path).providers?.anthropic?.keyEnv).toBe("MY_KEY");
  });
});

describe("resolveModel", () => {
  it("resolves a built-in alias to its model + provider", () => {
    const r = resolveModel("smart", {}, pricing);
    expect(r).toMatchObject({ provider: "anthropic", model: "claude-opus-4-8", keyEnv: "ANTHROPIC_API_KEY" });
  });

  it("honours a config alias and keyEnv override", () => {
    const r = resolveModel("mini", { aliases: { mini: "gpt-4o-mini" }, providers: { openai: { keyEnv: "OAI" } } }, pricing);
    expect(r).toMatchObject({ provider: "openai", model: "gpt-4o-mini", keyEnv: "OAI" });
  });

  it("throws an actionable error for an unknown model", () => {
    expect(() => resolveModel("no-such-model", {}, pricing)).toThrow(/Unknown model/);
  });
});
