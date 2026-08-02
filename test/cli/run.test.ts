import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { runChat, buildUserContent, type CliDeps } from "../../src/cli/run.js";
import type { ChatCommand } from "../../src/cli/args.js";
import { createTerminal } from "../../src/cli/tty.js";
import { providers } from "../../src/providers/index.js";
import { parsePricing } from "../../src/pricing/loader.js";
import { DriftLogger } from "../../src/cli/drift.js";
import { ExitCode } from "../../src/cli/exit.js";
import { fixtures } from "../fixtures/index.js";
import { toSSE, sseResponse, recordingFetch } from "../providers/mock.js";

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

function harness(isTTY: boolean) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (c) => (out += c));
  stderr.on("data", (c) => (err += c));
  const terminal = createTerminal({ stdout, stderr, isTTY });
  return { terminal, get out() { return out; }, get err() { return err; } };
}

function baseCmd(overrides: Partial<ChatCommand> = {}): ChatCommand {
  return { kind: "chat", models: ["claude-opus-4-8"], stream: true, json: false, continueSession: false, ...overrides };
}

function deps(io: ReturnType<typeof harness>, extra: Partial<CliDeps> = {}): CliDeps {
  const { fetch } = recordingFetch(() => sseResponse(anthropicSSE));
  return {
    providers,
    pricing,
    config: {},
    terminal: io.terminal,
    env: { ANTHROPIC_API_KEY: "test-key" },
    fetch,
    drift: new DriftLogger(() => {}),
    ...extra,
  };
}

describe("buildUserContent", () => {
  it("combines prompt and piped stdin", () => {
    expect(buildUserContent("summarise", "a b c")).toBe("summarise\n\na b c");
    expect(buildUserContent("only prompt", undefined)).toBe("only prompt");
    expect(buildUserContent(undefined, "only stdin")).toBe("only stdin");
  });
});

describe("runChat", () => {
  it("streams the response to stdout and cost to stderr when piped", async () => {
    const io = harness(false);
    const code = await runChat(baseCmd({ prompt: "hi" }), deps(io));
    expect(code).toBe(ExitCode.Success);
    expect(io.out).toContain("Hello there.");
    // Cost goes to stderr (piped), keeping stdout clean.
    expect(io.err).toContain("$0.00775");
    expect(io.err).toContain("1000 in / 300 out");
    expect(io.out).not.toContain("$0.00775");
  });

  it("emits a JSON object with usage and cost in --json mode", async () => {
    const io = harness(false);
    const code = await runChat(baseCmd({ prompt: "hi", json: true }), deps(io));
    expect(code).toBe(ExitCode.Success);
    const payload = JSON.parse(io.out);
    expect(payload).toMatchObject({ provider: "anthropic", model: "claude-opus-4-8" });
    expect(payload.usage).toMatchObject({ input: 1000, output: 300 });
    expect(payload.cost_usd).toBeCloseTo(0.0077475);
  });

  it("errors with exit code Provider when the key is missing", async () => {
    const io = harness(false);
    const code = await runChat(baseCmd({ prompt: "hi" }), deps(io, { env: {} }));
    expect(code).toBe(ExitCode.Provider);
    expect(io.err).toMatch(/ANTHROPIC_API_KEY not set/);
  });

  it("errors with exit code Usage for an unknown model", async () => {
    const io = harness(false);
    const code = await runChat(baseCmd({ prompt: "hi", models: ["bogus"] }), deps(io));
    expect(code).toBe(ExitCode.Usage);
    expect(io.err).toMatch(/Unknown model/);
  });

  it("errors with exit code Usage when there is no prompt", async () => {
    const io = harness(false);
    const code = await runChat(baseCmd({}), deps(io));
    expect(code).toBe(ExitCode.Usage);
  });

  it("surfaces a provider HTTP error as exit code Provider", async () => {
    const io = harness(false);
    const { fetch } = recordingFetch(() => new Response("nope", { status: 401 }));
    const code = await runChat(baseCmd({ prompt: "hi" }), deps(io, { fetch }));
    expect(code).toBe(ExitCode.Provider);
    expect(io.err).toMatch(/Error \(anthropic\)/);
  });

  it("reports ? (not $0.00) for a model that resolves but has no pricing", async () => {
    const io = harness(false);
    // The model id resolves by prefix (claude-*) but is absent from pricing,
    // so cost must be null and shown as ? with a note — never a wrong $0.00.
    const emptyPricing = parsePricing({
      updated: "2026-08-02",
      providers: { anthropic: { source: "u", models: { "other-model": { input: 1, output: 1, cacheWrite: 0, cacheRead: 0 } } } },
    });
    const code = await runChat(baseCmd({ prompt: "hi", models: ["claude-opus-4-8"] }), {
      ...deps(io),
      pricing: emptyPricing,
    });
    expect(code).toBe(ExitCode.Success);
    expect(io.err).toContain("?");
    expect(io.err).toMatch(/no pricing for "claude-opus-4-8"/);
    expect(io.err).not.toContain("$0.00");
  });
});
