import { describe, it, expect } from "vitest";
import { providers, isAbortError } from "../../src/providers/index.js";
import type { StreamEvent } from "../../src/providers/index.js";
import { abortableSSEResponse, recordingFetch } from "./mock.js";

/**
 * Ctrl-C must abort the in-flight request and surface as a thrown AbortError —
 * not a silent stop and not a `done` — so the caller knows the turn is partial
 * and does not record it as complete.
 */
describe("cancellation", () => {
  it("aborts the stream mid-flight and throws AbortError", async () => {
    const ac = new AbortController();
    const events = [
      { type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 1 } } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "partial" } },
    ];
    const { fetch } = recordingFetch((call) =>
      abortableSSEResponse(events, call.init.signal ?? undefined),
    );

    const seen: StreamEvent[] = [];
    let thrown: unknown;
    try {
      for await (const ev of providers.anthropic.stream(
        { model: "m", messages: [{ role: "user", content: "hi" }] },
        { fetch, apiKey: "test-key", signal: ac.signal },
      )) {
        seen.push(ev);
        if (ev.type === "text") ac.abort(); // cancel as soon as text arrives
      }
    } catch (error) {
      thrown = error;
    }

    expect(seen.some((e) => e.type === "text")).toBe(true);
    expect(seen.some((e) => e.type === "done")).toBe(false);
    expect(isAbortError(thrown)).toBe(true);
  });
});
