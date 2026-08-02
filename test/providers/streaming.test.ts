import { describe, it, expect } from "vitest";
import { providers } from "../../src/providers/index.js";
import type { StreamEvent } from "../../src/providers/index.js";
import type { Usage } from "../../src/usage.js";
import { fixtures } from "../fixtures/index.js";
import { toSSE, sseResponse, recordingFetch } from "./mock.js";

/**
 * Drive each real provider client against canned SSE built from the Phase 1
 * fixtures, and assert the streamed usage/text match. This proves the client's
 * SSE parsing + adapter wiring produces the same totals the contract suite pins.
 */
describe("provider streaming end-to-end (mock fetch)", () => {
  it.each(fixtures)("$provider: emits text, final usage, and done", async (fx) => {
    const provider = providers[fx.provider];
    const sse = toSSE(fx.events, { done: fx.provider === "openai" });
    const { fetch } = recordingFetch(() => sseResponse(sse));

    const events: StreamEvent[] = [];
    for await (const ev of provider.stream(
      { model: "test-model", messages: [{ role: "user", content: "hi" }] },
      { fetch, apiKey: "test-key" },
    )) {
      events.push(ev);
    }

    // Text pieces concatenate to the fixture's content.
    const text = events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(text.length).toBeGreaterThan(0);

    // The last usage event equals the fixture's exact expected totals.
    const usageEvents = events.filter((e) => e.type === "usage") as Array<{ usage: Usage }>;
    expect(usageEvents.at(-1)!.usage).toEqual(fx.expected);

    // The stream terminates with a single done and no error.
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });

  it("surfaces an unpriced-key/HTTP error as an error event, not a throw", async () => {
    const { fetch } = recordingFetch(() => new Response("bad key", { status: 401 }));
    const events: StreamEvent[] = [];
    for await (const ev of providers.anthropic.stream(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      { fetch, apiKey: "test-key" },
    )) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("error");
  });

  it("throws an actionable error when the API key is missing", async () => {
    const saved = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const gen = providers.anthropic.stream({ model: "m", messages: [{ role: "user", content: "hi" }] });
      const events: StreamEvent[] = [];
      for await (const ev of gen) events.push(ev);
      expect(events[0]!.type).toBe("error");
      expect((events[0] as { error: Error }).error.message).toMatch(/ANTHROPIC_API_KEY not set/);
    } finally {
      if (saved !== undefined) process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});
