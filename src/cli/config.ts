import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderName } from "../adapters/index.js";
import type { PricingTable } from "../pricing/loader.js";

/** Per-provider configuration. Note there is no place for an API key — keys live
 * only in env vars, referenced here by name. */
export interface ProviderConfig {
  /** Env var holding the key, overriding the provider default. */
  keyEnv?: string;
  /** Base URL override (proxy, gateway, self-hosted). */
  baseUrl?: string;
}

/** The user's `~/.tokenflow/config.json`, all fields optional. */
export interface Config {
  defaultModel?: string;
  providers?: Partial<Record<ProviderName, ProviderConfig>>;
  /** Short names mapping to a model id, e.g. `{ fast: "claude-haiku-4-5" }`. */
  aliases?: Record<string, string>;
  maxTokens?: number;
}

/** Default env var per provider, used when config doesn't override. */
const DEFAULT_KEY_ENV: Record<ProviderName, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
};

/** The built-in convenience aliases, overridable by config. */
const BUILTIN_ALIASES: Record<string, string> = {
  smart: "claude-opus-4-8",
  fast: "claude-haiku-4-5",
  cheap: "gpt-4o-mini",
};

/** Default config path: `~/.tokenflow/config.json`. */
export function defaultConfigPath(): string {
  return join(homedir(), ".tokenflow", "config.json");
}

/**
 * Load and validate config. A missing file is fine (returns defaults). The one
 * hard rule enforced here: a key value must never appear in the file. If someone
 * pastes a real key into `config.json`, we refuse to load it rather than let a
 * secret sit in a world-readable dotfile.
 */
export function loadConfig(path: string = defaultConfigPath()): Config {
  if (!existsSync(path)) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`Invalid config at ${path}: not valid JSON (${(cause as Error).message}).`);
  }
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Invalid config at ${path}: root must be an object.`);
  }
  const config = raw as Config & Record<string, unknown>;

  for (const [name, provider] of Object.entries(config.providers ?? {})) {
    const p = provider as Record<string, unknown>;
    if ("apiKey" in p || "key" in p) {
      throw new Error(
        `Invalid config at ${path}: providers.${name} contains an inline API key. ` +
          `Keys must live in env vars — set "keyEnv" to the env var name instead.`,
      );
    }
  }
  return config;
}

/** The resolved provider, model id, key env var, and base URL for one turn. */
export interface ResolvedModel {
  provider: ProviderName;
  model: string;
  keyEnv: string;
  baseUrl?: string;
}

/**
 * Turn a user-supplied model name (which may be an alias like `fast`) into a
 * concrete provider + model.
 *
 * Provider inference is deliberately INDEPENDENT of the pricing table: a model
 * with no rate yet must still be runnable, so its cost can be reported as `?`
 * (decision 3) instead of the model being rejected outright. We infer the
 * provider from the id's shape, fall back to the pricing table, then to config.
 */
export function resolveModel(name: string, config: Config, pricing: PricingTable): ResolvedModel {
  const aliases = { ...BUILTIN_ALIASES, ...config.aliases };
  const modelId = aliases[name] ?? name;

  const provider = providerOf(modelId, pricing);
  if (!provider) {
    throw new Error(
      `Unknown model "${name}"${modelId !== name ? ` (alias for "${modelId}")` : ""}. ` +
        `Use an id like claude-*, gpt-*, or gemini-*, define an alias in ` +
        `~/.tokenflow/config.json, or add it to pricing.json.`,
    );
  }

  const providerCfg = config.providers?.[provider];
  return {
    provider,
    model: modelId,
    keyEnv: providerCfg?.keyEnv ?? DEFAULT_KEY_ENV[provider],
    ...(providerCfg?.baseUrl ? { baseUrl: providerCfg.baseUrl } : {}),
  };
}

/** Common model-id prefixes, so a brand-new (unpriced) model still resolves. */
const PROVIDER_PREFIXES: Array<[RegExp, ProviderName]> = [
  [/^claude/i, "anthropic"],
  [/^(gpt|o[1-9]|chatgpt|text-|davinci)/i, "openai"],
  [/^gemini/i, "gemini"],
];

/** Infer the provider from the model id shape, then the pricing table. */
function providerOf(modelId: string, pricing: PricingTable): ProviderName | null {
  for (const [pattern, provider] of PROVIDER_PREFIXES) {
    if (pattern.test(modelId)) return provider;
  }
  for (const { provider, model } of pricing.list()) {
    if (model === modelId) return provider as ProviderName;
  }
  return null;
}
