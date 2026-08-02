import { adapters } from "../adapters/index.js";
import { createStream, type StreamSpec } from "./common.js";
import { ProviderError, type ChatRequest, type Provider, type StreamOptions } from "./types.js";

const KEY_ENV = "OPENAI_API_KEY";
const DEFAULT_BASE_URL = "https://api.openai.com";

/**
 * Build the OpenAI `/v1/chat/completions` streaming request. Exported for tests.
 *
 * CRITICAL: `stream_options.include_usage` MUST be present. Without it, a
 * streaming response carries no usage object at all and the cost tracker silently
 * reports a free session. `test/providers/openai.include_usage.test.ts` fails if
 * this ever goes missing.
 */
export function buildOpenAIRequest(
  request: ChatRequest,
  apiKey: string,
  baseUrl: string,
): { url: string; init: RequestInit } {
  const messages = [
    ...(request.system !== undefined ? [{ role: "system", content: request.system }] : []),
    ...request.messages.map((m) => ({ role: m.role, content: m.content })),
  ];
  const body: Record<string, unknown> = {
    model: request.model,
    stream: true,
    stream_options: { include_usage: true },
    messages,
  };
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;

  return {
    url: `${baseUrl}/v1/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
  };
}

const spec: StreamSpec = {
  provider: "openai",
  keyEnv: KEY_ENV,
  defaultBaseUrl: DEFAULT_BASE_URL,
  adapter: adapters.openai,
  buildRequest: buildOpenAIRequest,
  extractText(event) {
    const e = event as { choices?: Array<{ delta?: { content?: string } }> };
    return e.choices?.[0]?.delta?.content ?? "";
  },
  extractError(event) {
    const e = event as { error?: { message?: string } };
    if (e.error) return new ProviderError("openai", e.error.message ?? "OpenAI stream error.");
    return null;
  },
  isDoneSentinel: (data) => data === "[DONE]",
};

/** The OpenAI provider client. */
export const openaiProvider: Provider = {
  name: "openai",
  keyEnv: KEY_ENV,
  stream(request: ChatRequest, options?: StreamOptions) {
    return createStream(spec, request, options);
  },
};
