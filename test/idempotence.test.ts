import { describe, it, expect } from "vitest";
import { fixtures } from "./fixtures/index.js";
import { replay, duplicateEvery } from "./util.js";

/**
 * The bolded invariant from the brief: replaying an event stream with every event
 * duplicated must produce identical totals to replaying it once. This is what
 * makes re-sent or retried events harmless (the LangChain 2x-cache and Cline
 * drift bugs both came from violating it).
 */
describe("idempotence: duplicated events change nothing", () => {
  it.each(fixtures)("$provider: replay(events) === replay(duplicateEvery(events))", (fx) => {
    const once = replay(fx.adapter, fx.events);
    const twice = replay(fx.adapter, duplicateEvery(fx.events));
    expect(twice).toEqual(once);
  });
});
