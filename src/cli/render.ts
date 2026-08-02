import type { Terminal } from "./tty.js";

/**
 * A dependency-free, generic code highlighter. It is deliberately not a full
 * language grammar (that would mean pulling in highlight.js, a heavyweight dep the
 * brief rules out). Instead it colours the lexical features every C-family / script
 * language shares — strings, comments, numbers, and a common keyword set — which
 * covers the vast majority of code blocks an LLM emits, legibly, in ~40 lines.
 */
const KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "do",
  "switch", "case", "break", "continue", "class", "extends", "new", "this", "super",
  "import", "export", "from", "default", "async", "await", "yield", "try", "catch",
  "finally", "throw", "typeof", "instanceof", "in", "of", "void", "delete",
  "def", "elif", "lambda", "pass", "raise", "with", "as", "None", "True", "False",
  "public", "private", "protected", "static", "final", "interface", "type", "enum",
  "struct", "impl", "fn", "pub", "mut", "package", "func", "map", "range", "nil",
  "true", "false", "null", "undefined",
]);

/** Highlight one already-fenced code block. */
export function highlightCode(code: string, terminal: Terminal): string {
  if (!terminal.color) return code;
  const { c } = terminal;
  return code
    .split("\n")
    .map((line) => highlightLine(line, terminal))
    .join("\n")
    .replace(/\n$/, "");

  function highlightLine(line: string, _t: Terminal): string {
    // Comments win over everything else on the line.
    const commentMatch = line.match(/(^|\s)(\/\/|#).*$/);
    let head = line;
    let comment = "";
    if (commentMatch && !isInsideString(line, commentMatch.index ?? 0)) {
      head = line.slice(0, commentMatch.index);
      comment = line.slice(commentMatch.index);
    }
    const highlighted = head
      // strings (single, double, backtick)
      .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, (m) => c.green(m))
      // numbers
      .replace(/\b(\d+(?:\.\d+)?)\b/g, (m) => c.yellow(m))
      // keywords
      .replace(/\b([A-Za-z_]\w*)\b/g, (m) => (KEYWORDS.has(m) ? c.magenta(m) : m));
    return highlighted + (comment ? c.dim(comment) : "");
  }
}

/** Rough guard so a `//` inside a string literal isn't treated as a comment. */
function isInsideString(line: string, index: number): boolean {
  const before = line.slice(0, index);
  const quotes = (before.match(/["'`]/g) ?? []).length;
  return quotes % 2 === 1;
}

/** Apply inline markdown (`code`, **bold**, *italic*) to a single text line. */
function renderInline(line: string, terminal: Terminal): string {
  const { c } = terminal;
  return line
    .replace(/`([^`]+)`/g, (_m, code) => c.cyan(code))
    .replace(/\*\*([^*]+)\*\*/g, (_m, t) => c.bold(t))
    .replace(/(^|[^*])\*([^*]+)\*/g, (_m, pre, t) => `${pre}${c.italic(t)}`);
}

/** Decorate a single non-code line: headings, bullets, quotes, then inline. */
function renderTextLine(line: string, terminal: Terminal): string {
  const { c } = terminal;
  const heading = line.match(/^(#{1,6})\s+(.*)$/);
  if (heading) return c.bold(c.underline(heading[2] ?? ""));
  const bullet = line.match(/^(\s*)([-*+])\s+(.*)$/);
  if (bullet) return `${bullet[1]}${c.yellow("•")} ${renderInline(bullet[3] ?? "", terminal)}`;
  if (/^\s*>/.test(line)) return c.dim(renderInline(line.replace(/^\s*>\s?/, ""), terminal));
  return renderInline(line, terminal);
}

/**
 * Incremental markdown renderer for a streaming response.
 *
 * In non-color mode (piped output, decision 6) it is a pure passthrough: raw
 * bytes, no decoration, so `tokenflow "..." | tee` gets exactly the model's text.
 * In color mode it renders line by line, holding a code fence until its closing
 * ``` so the whole block can be highlighted at once (code appears in a burst,
 * which is the accepted trade-off for not shipping a streaming grammar).
 */
export class MarkdownStream {
  private buffer = "";
  private inFence = false;
  private fenceLines: string[] = [];

  constructor(private readonly terminal: Terminal) {}

  /** Feed a chunk of streamed text. */
  feed(text: string): void {
    if (!this.terminal.color) {
      this.terminal.out(text);
      return;
    }
    this.buffer += text;
    let newline: number;
    while ((newline = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      this.handleLine(line);
    }
  }

  /** Emit any buffered remainder once the stream ends. */
  flush(): void {
    if (!this.terminal.color) return;
    if (this.inFence) {
      this.emitFence(); // unterminated fence: emit what we have
      this.inFence = false;
    }
    if (this.buffer.length > 0) {
      this.terminal.out(renderTextLine(this.buffer, this.terminal));
      this.buffer = "";
    }
  }

  private handleLine(line: string): void {
    const fence = /^```(\w*)\s*$/.exec(line);
    if (this.inFence) {
      if (fence) {
        this.emitFence();
        this.inFence = false;
      } else {
        this.fenceLines.push(line);
      }
      return;
    }
    if (fence) {
      this.inFence = true;
      this.fenceLines = [];
      return;
    }
    this.terminal.out(`${renderTextLine(line, this.terminal)}\n`);
  }

  private emitFence(): void {
    const code = highlightCode(this.fenceLines.join("\n"), this.terminal);
    this.terminal.out(`${this.terminal.c.dim("┃ ")}${code.split("\n").join(`\n${this.terminal.c.dim("┃ ")}`)}\n`);
    this.fenceLines = [];
  }
}
