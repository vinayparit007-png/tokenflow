/** Test helpers for driving the provider clients offline against canned SSE. */

/** Serialise raw events as an SSE body, one `data:` line per event. */
export function toSSE(events: unknown[], opts: { done?: boolean } = {}): string {
  const lines = events.map((e) => `data: ${JSON.stringify(e)}\n\n`);
  if (opts.done) lines.push("data: [DONE]\n\n");
  return lines.join("");
}

/** A 200 response whose body streams the given text as a single chunk. */
export function sseResponse(sse: string, init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sse));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, ...init });
}

/**
 * A 200 response that emits `events` as separate SSE chunks and then stays open,
 * erroring the stream with an AbortError when `signal` fires. Used to test that
 * cancellation tears the stream down instead of hanging.
 */
export function abortableSSEResponse(events: unknown[], signal?: AbortSignal): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      const fail = () => controller.error(new DOMException("Aborted", "AbortError"));
      if (signal?.aborted) fail();
      else signal?.addEventListener("abort", fail, { once: true });
    },
  });
  return new Response(stream, { status: 200 });
}

/** Records every request and returns queued responses in order. */
export interface FetchCall {
  url: string;
  init: RequestInit;
  body: unknown;
}

export function recordingFetch(
  responder: (call: FetchCall, attempt: number) => Response | Promise<Response>,
): { fetch: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const bodyText = typeof init.body === "string" ? init.body : undefined;
    const call: FetchCall = {
      url: String(url),
      init,
      body: bodyText ? JSON.parse(bodyText) : undefined,
    };
    calls.push(call);
    return responder(call, calls.length - 1);
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}
