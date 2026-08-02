import { adapters } from "../adapters/index.js";
import { createStream, type StreamSpec } from "./common.js";
import { ProviderError, type ChatRequest, type Provider, type StreamOptions } from "./types.js";

const KEY_ENV = "ANTHROPIC_API_KEY";
const DEFAULT_BASE_URL = "https://api.anthropic.com";
/** Anthropic requires `max_tokens`; use a sane default when the caller omits it. */
const DEFAULT_MAX_TOKENS = 1024;

/** Build the Anthropic `/v1/messages` streaming request. Exported for tests. */
export function buildAnthropicRequest(
  request: ChatRequest,
  apiKey: string,
  baseUrl: string,
): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
    stream: true,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (request.system !== undefined) body.system = request.system;
  if (request.temperature !== undefined) body.temperature = request.temperature;

  return {
    url: `${baseUrl}/v1/messages`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    },
  };
}

const spec: StreamSpec = {
  provider: "anthropic",
  keyEnv: KEY_ENV,
  defaultBaseUrl: DEFAULT_BASE_URL,
  adapter: adapters.anthropic,
  buildRequest: buildAnthropicRequest,
  extractText(event) {
    const e = event as { type?: string; delta?: { type?: string; text?: string } };
    return e.type === "content_block_delta" && e.delta?.type === "text_delta" ? e.delta.text ?? "" : "";
  },
  extractError(event) {
    const e = event as { type?: string; error?: { message?: string } };
    if (e.type === "error") {
      return new ProviderError("anthropic", e.error?.message ?? "Anthropic stream error.");
    }
    return null;
  },
  // Anthropic ends with a `message_stop` event, not a sentinel line.
  isDoneSentinel: () => false,
};

/** The Anthropic provider client. */
export const anthropicProvider: Provider = {
  name: "anthropic",
  keyEnv: KEY_ENV,
  stream(request: ChatRequest, options?: StreamOptions) {
    return createStream(spec, request, options);
  },
};
