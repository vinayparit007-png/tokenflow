import type { Usage } from "../usage.js";

/** One conversation message. Kept deliberately minimal but shaped so a future
 * tool-use turn (content blocks) would extend `content` without a rewrite. */
export interface Message {
  role: "user" | "assistant";
  content: string;
}

/** A provider-agnostic chat request. Providers translate this into their own
 * wire body; nothing here is provider-specific. */
export interface ChatRequest {
  model: string;
  messages: Message[];
  system?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * The normalised streaming event union every provider emits. Raw provider SSE is
 * translated into exactly these four shapes, so the CLI never sees a wire format.
 */
export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "usage"; usage: Usage }
  | { type: "error"; error: ProviderError }
  | { type: "done" };

/** Per-call streaming options. `fetch` is injectable so the clients are testable
 * offline; `onRawEvent` powers the hidden `--record` capture. */
export interface StreamOptions {
  /** Aborts the in-flight request (Ctrl-C). */
  signal?: AbortSignal;
  /** Override the API key; falls back to the provider's env var. */
  apiKey?: string;
  /** Override the base URL (tests, proxies, self-hosted gateways). */
  baseUrl?: string;
  /** Injectable fetch, defaults to the global. */
  fetch?: typeof fetch;
  /** How many times to retry a retryable failure (429/5xx/network). Default 3. */
  maxRetries?: number;
  /** Called with every raw pre-adaptation event, for `--record`. */
  onRawEvent?: (event: unknown) => void;
}

/**
 * A provider is anything that can turn a request into a normalised event stream.
 *
 * `name` is a DISPLAY label, not necessarily one of the three built-in wire
 * formats (`adapters.ProviderName`). A user-added custom lab (DeepSeek, Groq,
 * Ollama, ...) gets its own `name` here — e.g. `"deepseek"` — while internally
 * reusing the OpenAI adapter, because it speaks the OpenAI-compatible wire
 * format. Which adapter a client uses and what it's called to the user are
 * deliberately decoupled: see `providers/custom.ts`.
 */
export interface Provider {
  readonly name: string;
  readonly keyEnv: string;
  stream(request: ChatRequest, options?: StreamOptions): AsyncGenerator<StreamEvent>;
}

/**
 * An error from a provider, carrying enough structure for the retry layer to
 * decide whether to retry and for the CLI to print something actionable rather
 * than a stack trace. `provider` is a display label (see `Provider.name`).
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    provider: string,
    message: string,
    opts: { status?: number; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}
