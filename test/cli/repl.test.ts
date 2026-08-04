import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { runRepl } from "../../src/cli/repl.js";
import type { ChatCommand } from "../../src/cli/args.js";
import { createTerminal } from "../../src/cli/tty.js";
import { providers } from "../../src/providers/index.js";
import { parsePricing } from "../../src/pricing/loader.js";
import { ExitCode } from "../../src/cli/exit.js";
import type { CliDeps } from "../../src/cli/run.js";
import { fixtures } from "../fixtures/index.js";
import { toSSE, sseResponse, abortableSSEResponse, recordingFetch } from "../providers/mock.js";

const pricing = parsePricing({
  updated: "2026-08-02",
  providers: {
    anthropic: {
      source: "u",
      models: { "claude-opus-4-8": { input: 3000, output: 15000, cacheWrite: 3750, cacheRead: 300 } },
    },
  },
});
const anthropicSSE = toSSE(fixtures[0]!.events);

function harness() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (c) => (out += c));
  stderr.on("data", (c) => (err += c));
  return { terminal: createTerminal({ stdout, stderr, isTTY: false }), get out() { return out; }, get err() { return err; } };
}

function baseCmd(): ChatCommand {
  return { kind: "chat", models: ["claude-opus-4-8"], stream: true, json: false, continueSession: false };
}

describe("runRepl — exit keys and Ctrl-C handling", () => {
  it("exits cleanly on an idle Ctrl-C (nothing streaming) instead of hanging", async () => {
    const io = harness();
    const stdin = new PassThrough();
    const before = process.listenerCount("SIGINT");
    const deps: CliDeps = { providers, pricing, config: {}, terminal: io.terminal, env: {} };

    const replPromise = runRepl(baseCmd(), deps, stdin);
    process.emit("SIGINT"); // simulate Ctrl-C while sitting at the prompt

    const code = await replPromise;
    expect(code).toBe(ExitCode.Success);
    expect(io.err).toContain("(exiting)");
    expect(process.listenerCount("SIGINT")).toBe(before); // handler was unregistered, no leak
  });

  it("does not promise Ctrl-D on win32, since Windows terminals never send it", async () => {
    const io = harness();
    const stdin = new PassThrough();
    const real = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const replPromise = runRepl(baseCmd(), { providers, pricing, config: {}, terminal: io.terminal, env: {} }, stdin);
      process.emit("SIGINT");
      await replPromise;
    } finally {
      Object.defineProperty(process, "platform", { value: real });
    }
    expect(io.err).not.toContain("Ctrl-D");
    expect(io.err).toContain("/exit");
  });

  it("Ctrl-C mid-turn cancels only that turn — the REPL survives and later turns still work", async () => {
    // Regression test: a shared AbortController reused across REPL turns stays
    // permanently "aborted" after the first cancel, silently killing every turn
    // after it. Each turn must get its own controller.
    const io = harness();
    const stdin = new PassThrough();
    const { fetch } = recordingFetch((call, attempt) =>
      attempt === 0
        ? (() => {
            process.emit("SIGINT"); // Ctrl-C fires exactly as the first request goes out
            return abortableSSEResponse(fixtures[0]!.events, call.init.signal ?? undefined);
          })()
        : sseResponse(anthropicSSE),
    );
    const deps: CliDeps = { providers, pricing, config: {}, terminal: io.terminal, env: { ANTHROPIC_API_KEY: "x" }, fetch };

    const replPromise = runRepl(baseCmd(), deps, stdin);
    stdin.write("first question\n");
    await new Promise((r) => setImmediate(r));
    expect(io.err).toContain("[cancelled]"); // turn 1 was cancelled, not silently swallowed

    stdin.write("second question\n");
    await new Promise((r) => setImmediate(r));
    expect(io.err).toContain("$0.00775"); // turn 2 completed for real — signal was NOT still tripped

    stdin.write("/exit\n");
    const code = await replPromise;
    expect(code).toBe(ExitCode.Success);
  });

  it("/exit always works regardless of platform or Ctrl-C support", async () => {
    const io = harness();
    const stdin = new PassThrough();
    const replPromise = runRepl(baseCmd(), { providers, pricing, config: {}, terminal: io.terminal, env: {} }, stdin);
    stdin.write("/exit\n");
    expect(await replPromise).toBe(ExitCode.Success);
  });
});
