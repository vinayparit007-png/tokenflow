import { adapters } from "../adapters/index.js";
import { createStream, type StreamSpec } from "./common.js";
import { ProviderError, type ChatRequest, type Provider, type StreamOptions } from "./types.js";

const KEY_ENV = "GEMINI_API_KEY";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com";

/**
 * Build the Gemini `streamGenerateContent` request. Exported for tests.
 *
 * The key goes in the `x-goog-api-key` header, not the URL query string: keys are
 * sensitive and query strings leak into logs and proxies.
 */
export function buildGeminiRequest(
  request: ChatRequest,
  apiKey: string,
  baseUrl: string,
): { url: string; init: RequestInit } {
  const body: Record<string, unknown> = {
    contents: request.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
  };
  if (request.system !== undefined) {
    body.systemInstruction = { parts: [{ text: request.system }] };
  }
  const generationConfig: Record<string, unknown> = {};
  if (request.maxTokens !== undefined) generationConfig.maxOutputTokens = request.maxTokens;
  if (request.temperature !== undefined) generationConfig.temperature = request.temperature;
  if (Object.keys(generationConfig).length > 0) body.generationConfig = generationConfig;

  return {
    url: `${baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
    },
  };
}

const spec: StreamSpec = {
  provider: "gemini",
  keyEnv: KEY_ENV,
  defaultBaseUrl: DEFAULT_BASE_URL,
  adapter: adapters.gemini,
  buildRequest: buildGeminiRequest,
  extractText(event) {
    const e = event as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const parts = e.candidates?.[0]?.content?.parts ?? [];
    return parts.map((p) => p.text ?? "").join("");
  },
  extractError(event) {
    const e = event as { error?: { message?: string } };
    if (e.error) return new ProviderError("gemini", e.error.message ?? "Gemini stream error.");
    return null;
  },
  isDoneSentinel: () => false,
};

/** The Gemini provider client. */
export const geminiProvider: Provider = {
  name: "gemini",
  keyEnv: KEY_ENV,
  stream(request: ChatRequest, options?: StreamOptions) {
    return createStream(spec, request, options);
  },
};
