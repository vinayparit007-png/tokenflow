import { describe, it, expect } from "vitest";
import { withRetry } from "../../src/providers/retry.js";
import { providers, ProviderError } from "../../src/providers/index.js";
import type { StreamEvent } from "../../src/providers/index.js";
import { toSSE, sseResponse, recordingFetch } from "./mock.js";
import { fixtures } from "../fixtures/index.js";

describe("withRetry backoff schedule", () => {
  it("retries retryable failures then succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new ProviderError("openai", "429", { retryable: true });
        return "ok";
      },
      (e) => e instanceof ProviderError && e.retryable,
      { sleep: async () => {}, random: () => 0 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("does not retry non-retryable failures", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new ProviderError("openai", "400", { retryable: false });
        },
        (e) => e instanceof ProviderError && e.retryable,
        { sleep: async () => {} },
      ),
    ).rejects.toThrow("400");
    expect(attempts).toBe(1);
  });

  it("uses full jitter bounded by exponential backoff", async () => {
    const delays: number[] = [];
    await withRetry(
      async (attempt) => {
        if (attempt < 3) throw new ProviderError("openai", "503", { retryable: true });
        return "ok";
      },
      () => true,
      {
        retries: 5,
        baseDelayMs: 500,
        maxDelayMs: 8000,
        random: () => 1, // pick the top of each jitter window
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );
    // window = min(max, base * 2^attempt) for attempts 0,1,2
    expect(delays).toEqual([500, 1000, 2000]);
  });

  it("gives up after `retries` attempts", async () => {
    let attempts = 0;
    await expect(
      withRetry(
        async () => {
          attempts += 1;
          throw new ProviderError("openai", "503", { retryable: true });
        },
        () => true,
        { retries: 2, sleep: async () => {} },
      ),
    ).rejects.toThrow();
    expect(attempts).toBe(3); // initial + 2 retries
  });
});

describe("provider retries transient HTTP failures", () => {
  it("retries a 503 then streams normally", async () => {
    const fx = fixtures[1]!; // openai fixture
    const sse = toSSE(fx.events, { done: true });
    const { fetch, calls } = recordingFetch((_call, attempt) =>
      attempt === 0 ? new Response("overloaded", { status: 503 }) : sseResponse(sse),
    );

    const events: StreamEvent[] = [];
    for await (const ev of providers.openai.stream(
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      { fetch, apiKey: "test-key", maxRetries: 3 },
    )) {
      events.push(ev);
    }

    expect(calls).toHaveLength(2); // one failed, one succeeded
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(events.some((e) => e.type === "error")).toBe(false);
  });
});
