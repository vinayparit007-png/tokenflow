import pc from "picocolors";
import type { Writable } from "node:stream";

/** picocolors' color-function bundle (no exported type name to import). */
type Colors = ReturnType<typeof pc.createColors>;

/** The inputs that decide output formatting. Passing these in (rather than
 * reading `process` directly) is what makes the chokepoint testable. */
export interface TerminalOptions {
  stdout: Writable;
  stderr: Writable;
  /** Whether stdout is a TTY. When false, output is treated as piped. */
  isTTY: boolean;
  /** Force color on/off (from `--color`/`--no-color` or `NO_COLOR`). */
  forceColor?: boolean;
  /** `NO_COLOR` env presence disables color regardless of TTY. */
  noColor?: boolean;
}

/**
 * THE OUTPUT CHOKEPOINT (decision 6). Every formatting decision in the CLI flows
 * through one `Terminal`, rather than scattering `process.stdout.isTTY` checks
 * across the codebase. It answers exactly three questions:
 *   - is this a TTY? (spinner, live cost line, markdown decoration)
 *   - should we emit ANSI color?
 *   - where does the cost line go — stdout (TTY) or stderr (piped, so
 *     `tokenflow "..." | jq` sees only the response on stdout)?
 */
export interface Terminal {
  readonly isTTY: boolean;
  readonly color: boolean;
  /** picocolors instance whose styling is a no-op when color is disabled. */
  readonly c: Colors;
  /** Write response content to stdout (the pipeable channel). */
  out(text: string): void;
  /** Write diagnostics/status to stderr. */
  err(text: string): void;
  /**
   * Write the cost report to the correct channel: stdout in a TTY, stderr when
   * piped. This is the whole point of decision 6 — piping stays clean.
   */
  cost(text: string): void;
}

/** Build the single terminal chokepoint from explicit options. */
export function createTerminal(options: TerminalOptions): Terminal {
  const noColor = options.noColor ?? false;
  const color = options.forceColor ?? (options.isTTY && !noColor);
  const c = pc.createColors(color);
  return {
    isTTY: options.isTTY,
    color,
    c,
    out(text) {
      options.stdout.write(text);
    },
    err(text) {
      options.stderr.write(text);
    },
    cost(text) {
      // TTY: cost belongs with the response on stdout. Piped: keep stdout clean
      // for the downstream consumer and send cost to stderr.
      (options.isTTY ? options.stdout : options.stderr).write(text);
    },
  };
}

/** Build a terminal from the real process, honouring NO_COLOR/FORCE_COLOR. */
export function terminalFromProcess(overrides: Partial<TerminalOptions> = {}): Terminal {
  const noColor = process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "";
  const forceColor = process.env.FORCE_COLOR === "1" ? true : undefined;
  return createTerminal({
    stdout: process.stdout,
    stderr: process.stderr,
    isTTY: Boolean(process.stdout.isTTY),
    noColor,
    ...(forceColor !== undefined ? { forceColor } : {}),
    ...overrides,
  });
}
