import { describe, it, expect } from "vitest";
import { createOpenAICompatibleProvider } from "../../src/providers/custom.js";
import type { StreamEvent } from "../../src/providers/index.js";
import { fixtures } from "../fixtures/index.js";
import { toSSE, sseResponse, recordingFetch } from "./mock.js";

/**
 * Proves the core claim behind "paste any lab's key, use any model": a
 * completely fictitious lab that speaks the OpenAI wire format streams
 * correctly through `createOpenAICompatibleProvider` — same SSE parsing, same
 * usage adapter, same totals as the built-in OpenAI client — using nothing but
 * a name and a key env var. No new adapter code involved.
 */
describe("createOpenAICompatibleProvider", () => {
  const openaiFixture = fixtures[1]!; // OpenAI-shaped events

  it("streams text and usage for a made-up lab via the reused OpenAI adapter", async () => {
    const acme = createOpenAICompatibleProvider("acmelabs", "ACMELABS_API_KEY");
    expect(acme.name).toBe("acmelabs");
    expect(acme.keyEnv).toBe("ACMELABS_API_KEY");

    const sse = toSSE(openaiFixture.events, { done: true });
    const { fetch, calls } = recordingFetch(() => sseResponse(sse));

    const events: StreamEvent[] = [];
    for await (const ev of acme.stream(
      { model: "acme-large", messages: [{ role: "user", content: "hi" }] },
      { fetch, apiKey: "test-key", baseUrl: "https://api.acmelabs.example" },
    )) {
      events.push(ev);
    }

    // Hits the custom base URL, not OpenAI's.
    expect(calls[0]!.url).toBe("https://api.acmelabs.example/v1/chat/completions");
    expect(calls[0]!.init.headers).toMatchObject({ authorization: "Bearer test-key" });
    // Still sets stream_options.include_usage — the request builder is genuinely reused.
    expect(calls[0]!.body).toMatchObject({ stream_options: { include_usage: true } });

    const usageEvents = events.filter((e) => e.type === "usage") as Array<{ usage: unknown }>;
    expect(usageEvents.at(-1)!.usage).toEqual(openaiFixture.expected);
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("surfaces the lab's own name in a provider error", async () => {
    const acme = createOpenAICompatibleProvider("acmelabs", "ACMELABS_API_KEY");
    const { fetch } = recordingFetch(() => new Response("bad key", { status: 401 }));

    const events: StreamEvent[] = [];
    for await (const ev of acme.stream(
      { model: "acme-large", messages: [{ role: "user", content: "hi" }] },
      { fetch, apiKey: "bad", baseUrl: "https://api.acmelabs.example" },
    )) {
      events.push(ev);
    }
    expect(events[0]!.type).toBe("error");
    expect((events[0] as { error: { provider: string; message: string } }).error.provider).toBe("acmelabs");
    expect((events[0] as { error: { message: string } }).error.message).toMatch(/acmelabs/);
  });
});
