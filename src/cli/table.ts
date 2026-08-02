import type { Terminal } from "./tty.js";

/** A table column with a header and a per-row cell accessor. */
export interface Column<T> {
  header: string;
  /** Cells are right-aligned when true (numbers), left otherwise. */
  right?: boolean;
  cell: (row: T) => string;
}

/**
 * Render a fixed-width aligned table. Deliberately plain — it reads fine both in
 * a color TTY and when redirected to a file, with only the header emphasised (and
 * even that no-ops when color is off). No box-drawing dependency, no wrapping:
 * comparison tables are short and wide, so horizontal scrolling in the terminal
 * is preferable to mangled wrapping.
 */
export function renderTable<T>(rows: T[], columns: Column<T>[], terminal: Terminal): string {
  const widths = columns.map((col) =>
    Math.max(col.header.length, ...rows.map((r) => stripAnsi(col.cell(r)).length)),
  );

  const pad = (text: string, width: number, right: boolean): string => {
    const gap = width - stripAnsi(text).length;
    const fill = " ".repeat(Math.max(0, gap));
    return right ? fill + text : text + fill;
  };

  const headerLine = columns
    .map((col, i) => terminal.c.bold(pad(col.header, widths[i]!, col.right ?? false)))
    .join("  ");
  const sep = terminal.c.dim(columns.map((_, i) => "─".repeat(widths[i]!)).join("  "));
  const bodyLines = rows.map((row) =>
    columns.map((col, i) => pad(col.cell(row), widths[i]!, col.right ?? false)).join("  "),
  );

  return [headerLine, sep, ...bodyLines].join("\n");
}

/** Length helpers must ignore ANSI so padding stays aligned when colored. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}
