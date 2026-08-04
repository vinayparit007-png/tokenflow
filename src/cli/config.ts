import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderName } from "../adapters/index.js";
import type { PricingTable, ModelRates } from "../pricing/loader.js";
import { parseModelRates } from "../pricing/loader.js";
import type { Provider } from "../providers/index.js";
import { createOpenAICompatibleProvider } from "../providers/index.js";

/** Per-provider configuration. Note there is no place for an API key — keys live
 * only in env vars, referenced here by name. */
export interface ProviderConfig {
  /** Env var holding the key, overriding the provider default. */
  keyEnv?: string;
  /** Base URL override (proxy, gateway, self-hosted). */
  baseUrl?: string;
}

/** Raw per-token rates in nanodollars, same shape as an entry in `pricing.json`. */
export interface RawModelRates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

/**
 * A user-added AI lab that speaks the OpenAI-compatible wire format — DeepSeek,
 * Mistral, Groq, Together, Fireworks, Perplexity, xAI/Grok, OpenRouter, Azure
 * OpenAI, or a local server (Ollama, LM Studio, vLLM). This is what lets someone
 * paste any lab's key and use any of its models without a code change: see
 * `createOpenAICompatibleProvider` for why the OpenAI adapter can be reused
 * as-is.
 */
export interface CustomProviderConfig {
  /** The lab's OpenAI-compatible base URL, e.g. "https://api.deepseek.com".
   * Required — there is no safe default to guess for an arbitrary lab. */
  baseUrl: string;
  /** Env var holding the key. Defaults to `<LABEL>_API_KEY` (label uppercased,
   * non-alphanumerics replaced with `_`) when omitted. */
  keyEnv?: string;
  /** Per-model nanodollar rates, same shape as `pricing.json`. A model absent
   * here still runs — its cost just shows `?` (decision 3), never a wrong $0. */
  models?: Record<string, RawModelRates>;
}

/** The user's `~/.tokenflow/config.json`, all fields optional. */
export interface Config {
  defaultModel?: string;
  providers?: Partial<Record<ProviderName, ProviderConfig>>;
  /** AI labs beyond the three built-in providers, keyed by a name you choose
   * (e.g. `"deepseek"`). Select a model from one with `-m deepseek:deepseek-chat`. */
  customProviders?: Record<string, CustomProviderConfig>;
  /** Short names mapping to a model id, e.g. `{ fast: "claude-haiku-4-5" }`.
   * May also map to a `"label:model"` pair to alias a custom provider's model. */
  aliases?: Record<string, string>;
  maxTokens?: number;
  /** Terminal theme name (aurora, neon, sunset, matrix). */
  theme?: string;
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
 * secret sit in a world-readable dotfile. Applies to `customProviders` too —
 * that's the section a user is most likely to paste a fresh key into by reflex
 * while wiring up a new lab.
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

  for (const [label, custom] of Object.entries(config.customProviders ?? {})) {
    const c = custom as unknown as Record<string, unknown>;
    if ("apiKey" in c || "key" in c) {
      throw new Error(
        `Invalid config at ${path}: customProviders.${label} contains an inline API key. ` +
          `Keys must live in env vars — set "keyEnv" to the env var name instead.`,
      );
    }
    if (typeof c.baseUrl !== "string" || c.baseUrl.trim() === "") {
      throw new Error(
        `Invalid config at ${path}: customProviders.${label}.baseUrl must be a non-empty URL string.`,
      );
    }
    if (c.models !== undefined) {
      if (typeof c.models !== "object" || c.models === null) {
        throw new Error(`Invalid config at ${path}: customProviders.${label}.models must be an object.`);
      }
      for (const [model, rawRates] of Object.entries(c.models as Record<string, unknown>)) {
        try {
          parseModelRates(rawRates, `customProviders.${label}.models.${model}`);
        } catch (cause) {
          throw new Error(`Invalid config at ${path}: ${(cause as Error).message}`);
        }
      }
    }
  }
  return config;
}

/**
 * The resolved provider, model id, and everything needed to actually call it.
 *
 * `providerName` is a display/history label (a built-in name, or a custom lab's
 * name from `config.customProviders`) — see the note on `Provider.name` in
 * `providers/types.ts` for why this is deliberately looser than the 3-way
 * `adapters.ProviderName` union. `provider` is the already-constructed live
 * client (built-in singleton, or freshly built for a custom lab); callers
 * should use it directly rather than looking anything up in a fixed table.
 */
export interface ResolvedModel {
  providerName: string;
  model: string;
  provider: Provider;
  /** From the global pricing table (built-in) or the custom provider's own
   * `models` map. Null means genuinely unpriced (decision 3) — never 0. */
  rates: ModelRates | null;
  keyEnv: string;
  baseUrl?: string;
  /** Config path to mention in a "key not set" error — differs for a built-in
   * provider (`providers.X.keyEnv`) vs. a custom one (`customProviders.X.keyEnv`). */
  configHint: string;
}

/**
 * Turn a user-supplied model name into a concrete, ready-to-call provider.
 *
 * Three addressing forms, tried in order:
 *  1. Alias (`fast`, `cheap`, or a user alias in config) — resolved first,
 *     iteratively, with a cycle guard; an alias's target is itself resolved
 *     through the same rules, so an alias MAY point at a `"label:model"` pair.
 *  2. Explicit `"label:model"` (e.g. `"deepseek:deepseek-chat"`, or
 *     `"openai:gpt-4o"` for a built-in) — always unambiguous, the only way to
 *     address a custom lab whose model ids don't look like anything TokenFlow
 *     recognises.
 *  3. A bare model id — matched against the built-in prefix patterns / pricing
 *     table (existing behaviour), then against each custom provider's own
 *     declared `models` map.
 *
 * Provider inference for built-ins is deliberately INDEPENDENT of the pricing
 * table: a model with no rate yet must still be runnable, so its cost can be
 * reported as `?` (decision 3) instead of the model being rejected outright.
 */
export function resolveModel(
  name: string,
  config: Config,
  pricing: PricingTable,
  builtins: Record<ProviderName, Provider>,
): ResolvedModel {
  const aliases = { ...BUILTIN_ALIASES, ...config.aliases };

  let target = name;
  const seenAliases = new Set<string>();
  while (aliases[target] !== undefined) {
    if (seenAliases.has(target)) {
      throw new Error(
        `Alias "${name}" resolves in a circle (back to "${target}"). Fix "aliases" in ~/.tokenflow/config.json.`,
      );
    }
    seenAliases.add(target);
    target = aliases[target]!;
  }

  const explicit = /^([A-Za-z0-9_-]+):(.+)$/.exec(target);
  if (explicit) {
    return resolveExplicit(name, explicit[1]!, explicit[2]!, config, pricing, builtins);
  }
  const modelId = target;

  const builtinProvider = providerOf(modelId, pricing);
  if (builtinProvider) {
    return resolveExplicit(name, builtinProvider, modelId, config, pricing, builtins);
  }

  const customMatches = Object.entries(config.customProviders ?? {})
    .filter(([, cfg]) => cfg.models && modelId in cfg.models)
    .map(([label]) => label);
  if (customMatches.length === 1) {
    return resolveExplicit(name, customMatches[0]!, modelId, config, pricing, builtins);
  }
  if (customMatches.length > 1) {
    throw new Error(
      `Model "${modelId}" is listed under more than one custom provider (${customMatches.join(", ")}). ` +
        `Use "label:model" to disambiguate, e.g. "${customMatches[0]}:${modelId}".`,
    );
  }

  throw new Error(
    `Unknown model "${name}"${modelId !== name ? ` (alias for "${modelId}")` : ""}. ` +
      `Use an id like claude-*, gpt-*, or gemini-*, an explicit "label:model" ` +
      `(e.g. "deepseek:deepseek-chat"), define an alias in ~/.tokenflow/config.json, ` +
      `or add it under pricing.json / customProviders.`,
  );
}

/** Resolve a known `(label, modelId)` pair — label is either a built-in
 * provider name or a key in `config.customProviders`. */
function resolveExplicit(
  originalName: string,
  label: string,
  modelId: string,
  config: Config,
  pricing: PricingTable,
  builtins: Record<ProviderName, Provider>,
): ResolvedModel {
  if (label in builtins) {
    const p = label as ProviderName;
    const providerCfg = config.providers?.[p];
    return {
      providerName: p,
      model: modelId,
      provider: builtins[p],
      rates: pricing.rates(p, modelId),
      keyEnv: providerCfg?.keyEnv ?? DEFAULT_KEY_ENV[p],
      configHint: `providers.${p}.keyEnv`,
      ...(providerCfg?.baseUrl ? { baseUrl: providerCfg.baseUrl } : {}),
    };
  }

  const custom = config.customProviders?.[label];
  if (!custom) {
    const known = [...Object.keys(builtins), ...Object.keys(config.customProviders ?? {})];
    throw new Error(
      `Unknown provider "${label}" (from model "${originalName}"). Known providers: ${known.join(", ")}. ` +
        `Add "${label}" under "customProviders" in ~/.tokenflow/config.json to use it.`,
    );
  }

  const keyEnv = custom.keyEnv ?? `${label.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  const rawRates = custom.models?.[modelId];
  const rates = rawRates ? parseModelRates(rawRates, `customProviders.${label}.models.${modelId}`) : null;

  return {
    providerName: label,
    model: modelId,
    provider: createOpenAICompatibleProvider(label, keyEnv),
    rates,
    keyEnv,
    baseUrl: custom.baseUrl,
    configHint: `customProviders.${label}.keyEnv`,
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
