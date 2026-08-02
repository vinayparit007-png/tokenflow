import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { runFanout } from "../../src/cli/fanout.js";
import type { ChatCommand } from "../../src/cli/args.js";
import { createTerminal } from "../../src/cli/tty.js";
import { providers } from "../../src/providers/index.js";
import { parsePricing } from "../../src/pricing/loader.js";
import { ExitCode } from "../../src/cli/exit.js";
import type { CliDeps } from "../../src/cli/run.js";
import { fixtures } from "../fixtures/index.js";
import { toSSE, sseResponse, recordingFetch } from "../providers/mock.js";

const pricing = parsePricing({
  updated: "2026-08-02",
  providers: {
    anthropic: { source: "u", models: { "claude-opus-4-8": { input: 3000, output: 15000, cacheWrite: 3750, cacheRead: 300 } } },
    openai: { source: "u", models: { "gpt-4o": { input: 2500, output: 10000, cacheWrite: 0, cacheRead: 1250 } } },
    gemini: { source: "u", models: { "gemini-2.5-pro": { input: 1250, output: 5000, cacheWrite: 0, cacheRead: 300 } } },
  },
});

const sseByProvider: Record<string, string> = {
  anthropic: toSSE(fixtures[0]!.events),
  openai: toSSE(fixtures[1]!.events, { done: true }),
  gemini: toSSE(fixtures[2]!.events),
};

function providerFromUrl(url: string): string {
  if (url.includes("anthropic")) return "anthropic";
  if (url.includes("openai")) return "openai";
  return "gemini";
}

function harness() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (c) => (out += c));
  stderr.on("data", (c) => (err += c));
  return { terminal: createTerminal({ stdout, stderr, isTTY: false }), get out() { return out; }, get err() { return err; } };
}

function baseCmd(models: string[]): ChatCommand {
  return { kind: "chat", prompt: "hi", models, stream: true, json: false, continueSession: false };
}

function deps(io: ReturnType<typeof harness>, responder?: Parameters<typeof recordingFetch>[0]): CliDeps {
  const { fetch } = recordingFetch(responder ?? ((call) => sseResponse(sseByProvider[providerFromUrl(call.url)]!)));
  return {
    providers,
    pricing,
    config: {},
    terminal: io.terminal,
    env: { ANTHROPIC_API_KEY: "a", OPENAI_API_KEY: "o", GEMINI_API_KEY: "g" },
    fetch,
    maxRetries: 0, // don't wait through real backoff in tests
  };
}

describe("runFanout", () => {
  it("runs all models and prints responses, footers, and a comparison table", async () => {
    const io = harness();
    const code = await runFanout(baseCmd(["claude-opus-4-8", "gpt-4o", "gemini-2.5-pro"]), deps(io));
    expect(code).toBe(ExitCode.Success);

    // Every model's header appears on stdout.
    for (const m of ["claude-opus-4-8", "gpt-4o", "gemini-2.5-pro"]) expect(io.out).toContain(m);
    // Comparison table (on the cost channel = stderr when piped).
    expect(io.err).toContain("MODEL");
    expect(io.err).toContain("TTFT");
    expect(io.err).toContain("total:");
    // Each per-model cost appears (anthropic: 1000*3000+300*15000+50*3750+200*300).
    expect(io.err).toContain("$0.00775");
  });

  it("survives a partial failure: one provider erroring doesn't kill the run", async () => {
    const io = harness();
    const responder = (call: { url: string }) =>
      providerFromUrl(call.url) === "openai"
        ? new Response("boom", { status: 500 })
        : sseResponse(sseByProvider[providerFromUrl(call.url)]!);
    const code = await runFanout(baseCmd(["claude-opus-4-8", "gpt-4o", "gemini-2.5-pro"]), deps(io, responder as never));

    expect(code).toBe(ExitCode.Success); // others succeeded
    expect(io.err).toContain("failed"); // the failed row is marked
    // The successful models still produced output.
    expect(io.out).toContain("claude-opus-4-8");
    expect(io.out).toContain("gemini-2.5-pro");
  });

  it("returns Provider exit code when every model fails", async () => {
    const io = harness();
    const code = await runFanout(baseCmd(["claude-opus-4-8", "gpt-4o"]), deps(io, () => new Response("no", { status: 500 })));
    expect(code).toBe(ExitCode.Provider);
  });

  it("marks a model with a missing key as failed without aborting others", async () => {
    const io = harness();
    const d = deps(io);
    d.env = { ANTHROPIC_API_KEY: "a" }; // no OpenAI key
    const code = await runFanout(baseCmd(["claude-opus-4-8", "gpt-4o"]), d);
    expect(code).toBe(ExitCode.Success);
    // The failed model shows its actionable reason in its response block.
    expect(io.out).toMatch(/OPENAI_API_KEY not set/);
    expect(io.err).toContain("failed"); // and is marked in the table
    expect(io.out).toContain("claude-opus-4-8"); // the other model still ran
  });
});
