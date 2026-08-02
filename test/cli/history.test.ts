import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PassThrough } from "node:stream";
import { runLog, runCost, type HistoryDeps } from "../../src/cli/history.js";
import { createTerminal } from "../../src/cli/tty.js";
import { HistoryStore, type StoredTurn } from "../../src/history/store.js";
import type { Usage } from "../../src/usage.js";

function usage(p: Partial<Usage>): Usage {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, reasoning: 0, complete: true, ...p };
}
function turn(p: Partial<StoredTurn>): StoredTurn {
  return {
    provider: "anthropic", model: "claude-opus-4-8", prompt: "hello", response: "hi",
    usage: usage({ input: 100, output: 50 }), cost: 1000n, latencyMs: 10, ttftMs: 5, ...p,
  };
}

function harness(store: HistoryStore, now?: Date): { deps: HistoryDeps; read: () => string } {
  const stdout = new PassThrough();
  let out = "";
  stdout.on("data", (c) => (out += c));
  const terminal = createTerminal({ stdout, stderr: new PassThrough(), isTTY: false });
  return { deps: { terminal, store, ...(now ? { now: () => now } : {}) }, read: () => out };
}

describe("history commands", () => {
  let store: HistoryStore;
  beforeEach(() => {
    store = new HistoryStore(":memory:");
    const s = store.startSession(new Date("2026-08-01T12:00:00Z"));
    store.recordTurn(s, turn({ prompt: "write a commit message", response: "feat: x", cost: 1000n }), new Date("2026-08-01T12:00:00Z"));
    store.recordTurn(s, turn({ model: "gpt-4o", provider: "openai", prompt: "explain recursion", cost: 500n }), new Date("2026-08-02T12:00:00Z"));
  });
  afterEach(() => store.close());

  it("log lists sessions with a cost total", () => {
    const { deps, read } = harness(store);
    runLog({ kind: "log" }, deps);
    const out = read();
    expect(out).toContain("STARTED");
    expect(out).toContain("$0.00000"); // 1500 nano rounds to 5dp display
    expect(out).toContain("write a commit message");
  });

  it("log search finds a matching turn", () => {
    const { deps, read } = harness(store);
    runLog({ kind: "log", query: "recursion" }, deps);
    expect(read()).toContain("explain recursion");
  });

  it("cost reports by model and by day with a total", () => {
    const { deps, read } = harness(store, new Date("2026-08-10T00:00:00Z"));
    runCost({ kind: "cost", since: "30d" }, deps);
    const out = read();
    expect(out).toContain("By model");
    expect(out).toContain("By day");
    expect(out).toContain("claude-opus-4-8");
    expect(out).toContain("2026-08-01");
    expect(out).toContain("Total:");
  });

  it("cost rejects a bad --since", () => {
    const { deps } = harness(store);
    expect(runCost({ kind: "cost", since: "soon" }, deps)).toBe(2);
  });
});
