import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveModel, type Config } from "../../src/cli/config.js";
import { parsePricing } from "../../src/pricing/loader.js";
import { providers } from "../../src/providers/index.js";

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

  it("refuses a config with an inline API key under providers", () => {
    const path = tmpConfig({ providers: { anthropic: { apiKey: "sk-secret" } } });
    expect(() => loadConfig(path)).toThrow(/inline API key/);
  });

  it("loads keyEnv references", () => {
    const path = tmpConfig({ providers: { anthropic: { keyEnv: "MY_KEY" } } });
    expect(loadConfig(path).providers?.anthropic?.keyEnv).toBe("MY_KEY");
  });

  it("refuses a customProviders entry with an inline API key", () => {
    const path = tmpConfig({ customProviders: { acme: { baseUrl: "https://api.acme.dev", apiKey: "sk-secret" } } });
    expect(() => loadConfig(path)).toThrow(/inline API key/);
  });

  it("requires baseUrl on every custom provider", () => {
    const path = tmpConfig({ customProviders: { acme: { keyEnv: "ACME_API_KEY" } } });
    expect(() => loadConfig(path)).toThrow(/baseUrl/);
  });

  it("validates custom provider model rates eagerly, with an actionable message", () => {
    const path = tmpConfig({
      customProviders: {
        acme: { baseUrl: "https://api.acme.dev", models: { "acme-large": { input: -1, output: 0, cacheWrite: 0, cacheRead: 0 } } },
      },
    });
    expect(() => loadConfig(path)).toThrow(/customProviders\.acme\.models\.acme-large\.input/);
    expect(() => loadConfig(path)).not.toThrow(/Invalid pricing file/); // wrong-file framing must not leak in
  });

  it("loads a well-formed custom provider", () => {
    const path = tmpConfig({
      customProviders: {
        acme: {
          baseUrl: "https://api.acme.dev",
          keyEnv: "ACME_API_KEY",
          models: { "acme-large": { input: 100, output: 300, cacheWrite: 0, cacheRead: 50 } },
        },
      },
    });
    const config = loadConfig(path);
    expect(config.customProviders?.acme?.baseUrl).toBe("https://api.acme.dev");
  });
});

describe("resolveModel — built-ins (unchanged behaviour)", () => {
  it("resolves a built-in alias to its model + provider", () => {
    const r = resolveModel("smart", {}, pricing, providers);
    expect(r).toMatchObject({ providerName: "anthropic", model: "claude-opus-4-8", keyEnv: "ANTHROPIC_API_KEY" });
    expect(r.provider).toBe(providers.anthropic); // the live client, not a string
  });

  it("honours a config alias and keyEnv override", () => {
    const config: Config = { aliases: { mini: "gpt-4o-mini" }, providers: { openai: { keyEnv: "OAI" } } };
    const r = resolveModel("mini", config, pricing, providers);
    expect(r).toMatchObject({ providerName: "openai", model: "gpt-4o-mini", keyEnv: "OAI" });
  });

  it("throws an actionable error for a genuinely unknown model", () => {
    expect(() => resolveModel("no-such-model-xyz", {}, pricing, providers)).toThrow(/Unknown model/);
  });

  it("explicit label:model addressing works for a built-in too", () => {
    const r = resolveModel("openai:gpt-4o-mini", {}, pricing, providers);
    expect(r).toMatchObject({ providerName: "openai", model: "gpt-4o-mini" });
  });

  it("detects a circular alias instead of infinite-looping", () => {
    const config: Config = { aliases: { a: "b", b: "a" } };
    expect(() => resolveModel("a", config, pricing, providers)).toThrow(/circle/);
  });
});

describe("resolveModel — custom AI labs", () => {
  // A fictitious lab, deliberately not one of the real examples used elsewhere,
  // to prove this works for genuinely ANY name — not a hardcoded special case.
  const config: Config = {
    customProviders: {
      acmelabs: {
        baseUrl: "https://api.acmelabs.example",
        models: { "acme-large": { input: 100, output: 300, cacheWrite: 0, cacheRead: 50 } },
      },
    },
  };

  it("resolves via explicit label:model addressing", () => {
    const r = resolveModel("acmelabs:acme-large", config, pricing, providers);
    expect(r.providerName).toBe("acmelabs");
    expect(r.model).toBe("acme-large");
    expect(r.baseUrl).toBe("https://api.acmelabs.example");
    expect(r.rates).toEqual({ input: 100n, output: 300n, cacheWrite: 0n, cacheRead: 50n });
  });

  it("resolves via a bare model id that only one custom provider declares", () => {
    const r = resolveModel("acme-large", config, pricing, providers);
    expect(r.providerName).toBe("acmelabs");
  });

  it("derives keyEnv from the label when not given: ACMELABS_API_KEY", () => {
    const r = resolveModel("acmelabs:acme-large", config, pricing, providers);
    expect(r.keyEnv).toBe("ACMELABS_API_KEY");
    expect(r.configHint).toBe("customProviders.acmelabs.keyEnv");
  });

  it("honours an explicit keyEnv override", () => {
    const withKeyEnv: Config = {
      customProviders: { acmelabs: { baseUrl: "https://api.acmelabs.example", keyEnv: "MY_ACME_KEY" } },
    };
    const r = resolveModel("acmelabs:whatever-model", withKeyEnv, pricing, providers);
    expect(r.keyEnv).toBe("MY_ACME_KEY");
  });

  it("still runs a model absent from the custom provider's models map — rates null, never 0 (decision 3)", () => {
    const r = resolveModel("acmelabs:brand-new-model", config, pricing, providers);
    expect(r.rates).toBeNull();
    expect(r.model).toBe("brand-new-model");
  });

  it("returns the live provider client, ready to .stream()", () => {
    const r = resolveModel("acmelabs:acme-large", config, pricing, providers);
    expect(typeof r.provider.stream).toBe("function");
    expect(r.provider.name).toBe("acmelabs");
  });

  it("an alias may point at a label:model pair", () => {
    const withAlias: Config = { ...config, aliases: { big: "acmelabs:acme-large" } };
    const r = resolveModel("big", withAlias, pricing, providers);
    expect(r.providerName).toBe("acmelabs");
    expect(r.model).toBe("acme-large");
  });

  it("throws naming the unknown label, distinct from an unknown model", () => {
    expect(() => resolveModel("nosuchlab:some-model", config, pricing, providers)).toThrow(/Unknown provider "nosuchlab"/);
  });

  it("disambiguates when two custom providers declare the same bare model id", () => {
    const ambiguous: Config = {
      customProviders: {
        acmelabs: { baseUrl: "https://a.example", models: { shared: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 } } },
        otherlab: { baseUrl: "https://b.example", models: { shared: { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 } } },
      },
    };
    expect(() => resolveModel("shared", ambiguous, pricing, providers)).toThrow(/more than one custom provider/);
    // But explicit addressing always works.
    expect(resolveModel("otherlab:shared", ambiguous, pricing, providers).providerName).toBe("otherlab");
  });
});
