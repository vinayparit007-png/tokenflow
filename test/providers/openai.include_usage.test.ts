import { describe, it, expect } from "vitest";
import { buildOpenAIRequest } from "../../src/providers/index.js";

/**
 * This is the guard test the brief demands: OpenAI streaming returns NO usage
 * unless `stream_options: { include_usage: true }` is set. If that option ever
 * disappears from the request body, the cost tracker would silently report every
 * OpenAI session as free — so this test must fail loudly.
 */
describe("OpenAI request always asks for usage", () => {
  it("sets stream_options.include_usage = true", () => {
    const { init } = buildOpenAIRequest(
      { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] },
      "sk-test",
      "https://api.openai.com",
    );
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
  });
});
