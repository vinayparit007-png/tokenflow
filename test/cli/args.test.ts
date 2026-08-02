import { describe, it, expect } from "vitest";
import { parseArgs, type ChatCommand } from "../../src/cli/args.js";

describe("parseArgs", () => {
  it("treats a bare string as the prompt", () => {
    const cmd = parseArgs(["hello world"]) as ChatCommand;
    expect(cmd.kind).toBe("chat");
    expect(cmd.prompt).toBe("hello world");
    expect(cmd.stream).toBe(true);
  });

  it("joins multiple positionals into one prompt", () => {
    const cmd = parseArgs(["write", "a", "haiku"]) as ChatCommand;
    expect(cmd.prompt).toBe("write a haiku");
  });

  it("parses model aliases and comma fan-out", () => {
    const cmd = parseArgs(["-m", "claude,gpt,gemini", "hi"]) as ChatCommand;
    expect(cmd.models).toEqual(["claude", "gpt", "gemini"]);
  });

  it("parses system, flags, and max-tokens", () => {
    const cmd = parseArgs(["--system", "be terse", "--no-stream", "--json", "--max-tokens", "50", "hi"]) as ChatCommand;
    expect(cmd.system).toBe("be terse");
    expect(cmd.stream).toBe(false);
    expect(cmd.json).toBe(true);
    expect(cmd.maxTokens).toBe(50);
  });

  it("captures the hidden --record path", () => {
    const cmd = parseArgs(["--record", "out.json", "hi"]) as ChatCommand;
    expect(cmd.record).toBe("out.json");
  });

  it("errors on unknown flags and missing values", () => {
    expect(parseArgs(["--nope"])).toEqual({ kind: "error", message: "Unknown flag: --nope" });
    expect(parseArgs(["--model"])).toMatchObject({ kind: "error" });
  });

  it("recognises help and version", () => {
    expect(parseArgs(["--help"]).kind).toBe("help");
    expect(parseArgs(["-v"]).kind).toBe("version");
  });

  it("parses log and cost subcommands", () => {
    expect(parseArgs(["log"]).kind).toBe("log");
    expect(parseArgs(["log", "search", "commit message"])).toMatchObject({ kind: "log", query: "commit message" });
    expect(parseArgs(["cost", "--since", "7d"])).toMatchObject({ kind: "cost", since: "7d" });
  });

  it("passes through args after --", () => {
    const cmd = parseArgs(["--", "--not-a-flag"]) as ChatCommand;
    expect(cmd.prompt).toBe("--not-a-flag");
  });
});
