import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { HistoryStore, sanitizeFtsQuery, type StoredTurn } from "../../src/history/store.js";
import type { Usage } from "../../src/usage.js";

function usage(p: Partial<Usage>): Usage {
  return { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, reasoning: 0, complete: true, ...p };
}

function turn(p: Partial<StoredTurn>): StoredTurn {
  return {
    provider: "anthropic",
    model: "claude-opus-4-8",
    prompt: "hello",
    response: "hi there",
    usage: usage({ input: 100, output: 50 }),
    cost: 1000n,
    latencyMs: 120,
    ttftMs: 40,
    ...p,
  };
}

describe("HistoryStore", () => {
  let store: HistoryStore;
  beforeEach(() => {
    store = new HistoryStore(":memory:");
  });
  afterEach(() => store.close());

  it("records turns and totals a session cost", () => {
    const s = store.startSession();
    store.recordTurn(s, turn({ cost: 1000n }));
    store.recordTurn(s, turn({ cost: 2500n }));
    const sessions = store.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ id: s, turns: 2, cost: 3500n });
  });

  it("propagates null in a session cost when a turn is unpriced", () => {
    const s = store.startSession();
    store.recordTurn(s, turn({ cost: 1000n }));
    store.recordTurn(s, turn({ cost: null }));
    expect(store.listSessions()[0]!.cost).toBeNull();
  });

  it("reconstructs session messages for --continue", () => {
    const s = store.startSession();
    store.recordTurn(s, turn({ prompt: "q1", response: "a1" }));
    store.recordTurn(s, turn({ prompt: "q2", response: "a2" }));
    expect(store.sessionMessages(s)).toEqual([
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
      { role: "assistant", content: "a2" },
    ]);
  });

  it("returns the last session id, or null when empty", () => {
    expect(store.lastSessionId()).toBeNull();
    const a = store.startSession();
    const b = store.startSession();
    expect(store.lastSessionId()).toBe(b);
    expect(b).toBeGreaterThan(a);
  });

  it("full-text searches prompts and responses", () => {
    const s = store.startSession();
    store.recordTurn(s, turn({ prompt: "write a commit message", response: "feat: add widget" }));
    store.recordTurn(s, turn({ prompt: "explain recursion", response: "a function calling itself" }));

    const commit = store.search("commit");
    expect(commit).toHaveLength(1);
    expect(commit[0]!.prompt).toContain("commit");

    const recursion = store.search("recursion");
    expect(recursion[0]!.response).toContain("calling itself");

    expect(store.search("nonexistentword")).toHaveLength(0);
  });

  it("does not choke on FTS operator characters in the query", () => {
    const s = store.startSession();
    store.recordTurn(s, turn({ prompt: "a AND b OR c", response: "x" }));
    expect(() => store.search('a AND "b')).not.toThrow();
  });

  it("returns turns since a cutoff for the spend report", () => {
    const s = store.startSession();
    const old = new Date("2020-01-01T00:00:00Z");
    const recent = new Date("2026-08-01T00:00:00Z");
    store.recordTurn(s, turn({ cost: 100n }), old);
    store.recordTurn(s, turn({ cost: 200n }), recent);
    const rows = store.turnsSince(new Date("2026-01-01T00:00:00Z"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.cost).toBe(200n);
  });
});

describe("sanitizeFtsQuery", () => {
  it("quotes tokens and strips embedded quotes", () => {
    expect(sanitizeFtsQuery('commit message')).toBe('"commit" "message"');
    expect(sanitizeFtsQuery('a "b" c')).toBe('"a" "b" "c"');
    expect(sanitizeFtsQuery("   ")).toBe("");
  });
});
