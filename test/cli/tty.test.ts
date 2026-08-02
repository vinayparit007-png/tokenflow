import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { createTerminal } from "../../src/cli/tty.js";

function capture() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = "";
  let err = "";
  stdout.on("data", (c) => (out += c));
  stderr.on("data", (c) => (err += c));
  return { stdout, stderr, get out() { return out; }, get err() { return err; } };
}

describe("Terminal chokepoint (decision 6)", () => {
  it("in a TTY: color on, cost goes to stdout", () => {
    const io = capture();
    const t = createTerminal({ stdout: io.stdout, stderr: io.stderr, isTTY: true });
    expect(t.color).toBe(true);
    t.out("response");
    t.cost("$0.01");
    expect(io.out).toBe("response$0.01"); // cost joins stdout in a TTY
    expect(io.err).toBe("");
  });

  it("when piped: no color, cost goes to stderr so stdout stays clean", () => {
    const io = capture();
    const t = createTerminal({ stdout: io.stdout, stderr: io.stderr, isTTY: false });
    expect(t.color).toBe(false);
    t.out("response");
    t.cost("$0.01");
    expect(io.out).toBe("response"); // stdout carries ONLY the response
    expect(io.err).toBe("$0.01");
  });

  it("NO_COLOR disables color even in a TTY", () => {
    const io = capture();
    const t = createTerminal({ stdout: io.stdout, stderr: io.stderr, isTTY: true, noColor: true });
    expect(t.color).toBe(false);
  });

  it("forceColor overrides TTY detection", () => {
    const io = capture();
    const t = createTerminal({ stdout: io.stdout, stderr: io.stderr, isTTY: false, forceColor: true });
    expect(t.color).toBe(true);
  });
});
