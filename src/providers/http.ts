import type { ProviderName } from "../adapters/index.js";
import { ProviderError, type StreamOptions } from "./types.js";
import { withRetry } from "./retry.js";

/**
 * Resolve an API key, preferring an explicit override, then the provider's env
 * var. Throws an actionable error naming both the env var and the config path —
 * never a bare "undefined" — because a missing key is the single most common
 * first-run failure.
 */
export function resolveApiKey(
  provider: ProviderName,
  keyEnv: string,
  options: StreamOptions,
): string {
  const key = options.apiKey ?? process.env[keyEnv];
  if (!key) {
    throw new ProviderError(
      provider,
      `${keyEnv} not set — add it to your shell (e.g. \`export ${keyEnv}=...\`) ` +
        `or set \`providers.${provider}.keyEnv\` in ~/.tokenflow/config.json.`,
    );
  }
  return key;
}

/** True for failures worth retrying: rate limits, server errors, transient
 * network faults. Client errors (4xx other than 429) are not retried. */
function isRetryable(error: unknown): boolean {
  if (error instanceof ProviderError) return error.retryable;
  // A raw fetch network failure (DNS, reset, timeout) is a TypeError and worth a retry.
  return error instanceof TypeError;
}

/**
 * POST a streaming request with retry/backoff and return the live response body.
 * Retries happen only before any bytes are consumed, so we never replay a partly
 * streamed turn (which would duplicate tokens). Non-2xx responses become
 * `ProviderError`s: 429/5xx retryable, everything else fatal with the body text.
 */
export async function postStream(
  provider: ProviderName,
  url: string,
  init: RequestInit,
  options: StreamOptions,
): Promise<ReadableStream<Uint8Array>> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await withRetry(
    async () => {
      const res = await fetchImpl(url, { ...init, signal: options.signal });
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = res.headers.get("retry-after");
        throw new ProviderError(
          provider,
          `${provider} API returned ${res.status}${retryAfter ? ` (retry-after ${retryAfter}s)` : ""}.`,
          { status: res.status, retryable: true },
        );
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderError(provider, describeHttpError(provider, res.status, body), {
          status: res.status,
          retryable: false,
        });
      }
      return res;
    },
    isRetryable,
    { retries: options.maxRetries, signal: options.signal },
  );

  if (!response.body) {
    throw new ProviderError(provider, `${provider} API returned an empty response body.`);
  }
  return response.body;
}

/** Turn a non-retryable HTTP status into an actionable one-liner. */
function describeHttpError(provider: ProviderName, status: number, body: string): string {
  const snippet = body.slice(0, 300).trim();
  if (status === 401 || status === 403) {
    return `${provider} rejected the API key (${status}). Check the key is valid and has access to the model.`;
  }
  if (status === 404) {
    return `${provider} returned 404 — the model id is probably wrong or unavailable to this key.`;
  }
  return `${provider} API error ${status}${snippet ? `: ${snippet}` : ""}.`;
}
