import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { createTerminal, type Terminal } from "../../src/cli/tty.js";
import { MarkdownStream } from "../../src/cli/render.js";

function harness(color: boolean): { terminal: Terminal; read: () => string } {
  const stdout = new PassThrough();
  let out = "";
  stdout.on("data", (c) => (out += c));
  const terminal = createTerminal({ stdout, stderr: new PassThrough(), isTTY: color, forceColor: color });
  return { terminal, read: () => out };
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*m/;

describe("MarkdownStream", () => {
  it("passes raw text through unchanged when color is off (piped)", () => {
    const { terminal, read } = harness(false);
    const md = new MarkdownStream(terminal);
    md.feed("# Heading\n**bold** and `code`\n");
    md.flush();
    expect(read()).toBe("# Heading\n**bold** and `code`\n");
    expect(ANSI.test(read())).toBe(false);
  });

  it("decorates markdown with ANSI when color is on", () => {
    const { terminal, read } = harness(true);
    const md = new MarkdownStream(terminal);
    md.feed("**bold** text\n");
    md.flush();
    const out = read();
    expect(ANSI.test(out)).toBe(true);
    expect(out).not.toContain("**"); // markers consumed
    expect(out).toContain("bold");
  });

  it("holds a code fence until it closes, then highlights it", () => {
    const { terminal, read } = harness(true);
    const md = new MarkdownStream(terminal);
    md.feed("```js\nconst x = 1;\n");
    // Before the closing fence, nothing from inside the block is emitted yet.
    expect(read()).toBe("");
    md.feed("```\n");
    const out = read();
    expect(out).toContain("x"); // code emitted after close
    expect(ANSI.test(out)).toBe(true); // keyword/number highlighting present
  });
});
