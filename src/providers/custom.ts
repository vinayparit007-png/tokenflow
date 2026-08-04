import { adapters } from "../adapters/index.js";
import { buildOpenAIRequest } from "./openai.js";
import { createStream, type StreamSpec } from "./common.js";
import { ProviderError, type ChatRequest, type Provider, type StreamOptions } from "./types.js";

/**
 * Build a live client for any OpenAI-COMPATIBLE lab.
 *
 * This is what makes "paste any AI lab's key, use any of its models" possible
 * without writing a new adapter per lab: DeepSeek, Mistral, Groq, Together,
 * Fireworks, Perplexity, xAI/Grok, OpenRouter, Azure OpenAI, and local servers
 * (Ollama, LM Studio, vLLM) all speak the same `/chat/completions` streaming
 * wire format OpenAI does — same request shape, same SSE chunks, same
 * `[DONE]` sentinel. So a custom lab reuses `adapters.openai` (the pure usage
 * reducer) and `buildOpenAIRequest` (the request builder) UNCHANGED; only the
 * display name, base URL, and key env var are specific to the lab.
 *
 * A lab with a genuinely different wire format (not OpenAI-shaped) needs a real
 * adapter, the way Anthropic and Gemini have one — that's a small, contained
 * addition (see `src/adapters/`), not a rewrite, but it is still code, not
 * config. This factory only covers the OpenAI-compatible case, which is the
 * overwhelming majority of labs that have shipped since OpenAI's format became
 * a de facto standard.
 */
export function createOpenAICompatibleProvider(name: string, keyEnv: string): Provider {
  const spec: StreamSpec = {
    provider: name,
    keyEnv,
    // No sensible default: a custom lab's base URL is never optional, and
    // guessing one would risk silently sending a key to the wrong host.
    // config.ts validates baseUrl is present before this is ever called.
    defaultBaseUrl: "",
    adapter: adapters.openai,
    buildRequest: buildOpenAIRequest,
    extractText(event) {
      const e = event as { choices?: Array<{ delta?: { content?: string } }> };
      return e.choices?.[0]?.delta?.content ?? "";
    },
    extractError(event) {
      const e = event as { error?: { message?: string } };
      if (e.error) return new ProviderError(name, e.error.message ?? `${name} stream error.`);
      return null;
    },
    isDoneSentinel: (data) => data === "[DONE]",
  };

  return {
    name,
    keyEnv,
    stream(request: ChatRequest, options?: StreamOptions) {
      return createStream(spec, request, options);
    },
  };
}
