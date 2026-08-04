import type { Terminal } from "./tty.js";

/**
 * Visual theming for the TTY. Everything here is truecolor ANSI written directly
 * (picocolors only does the 16 base colors, and a smooth gradient needs 24-bit),
 * which is fine under decision 6: it is still "plain stdout writes", and every
 * helper NO-OPS when `terminal.color` is false, so piped output stays byte-plain.
 */

/** An RGB colour. */
export type RGB = [number, number, number];

/** A named palette: a set of gradient stops plus a single accent colour. */
export interface Theme {
  name: string;
  /** Gradient colour stops, interpolated left-to-right across text. */
  stops: RGB[];
  /** Solid accent for prompts, totals, and small highlights. */
  accent: RGB;
}

/** Built-in themes. `aurora` (a Gemini-like blue→purple→pink) is the default. */
export const THEMES: Record<string, Theme> = {
  aurora: { name: "aurora", stops: [[80, 140, 255], [150, 110, 255], [255, 110, 200]], accent: [150, 130, 255] },
  neon: { name: "neon", stops: [[0, 255, 170], [0, 220, 255], [120, 120, 255]], accent: [0, 255, 190] },
  sunset: { name: "sunset", stops: [[255, 200, 40], [255, 110, 60], [220, 40, 120]], accent: [255, 140, 60] },
  matrix: { name: "matrix", stops: [[120, 255, 120], [0, 200, 70], [0, 120, 40]], accent: [0, 230, 90] },
};

export const DEFAULT_THEME = "aurora";

/** Resolve a theme by name, falling back to the default for unknown names. */
export function themeFor(name: string | undefined): Theme {
  return (name && THEMES[name]) || THEMES[DEFAULT_THEME]!;
}

/** Names of all built-in themes, for help text. */
export function themeNames(): string[] {
  return Object.keys(THEMES);
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Colour at position `t` in [0,1] across the theme's gradient stops. */
function colorAt(stops: RGB[], t: number): RGB {
  if (stops.length === 1) return stops[0]!;
  const seg = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
  const localT = t * (stops.length - 1) - seg;
  const a = stops[seg]!;
  const b = stops[seg + 1]!;
  return [lerp(a[0], b[0], localT), lerp(a[1], b[1], localT), lerp(a[2], b[2], localT)];
}

/** Wrap text in a solid truecolor foreground (no-op when color is off). */
export function paint(text: string, rgb: RGB, terminal: Terminal, bold = false): string {
  if (!terminal.color) return text;
  const b = bold ? "\x1b[1m" : "";
  const reset = bold ? "\x1b[22;39m" : "\x1b[39m";
  return `${b}\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}${reset}`;
}

/** Paint text with a left-to-right gradient across the theme's stops. Spaces are
 * left uncoloured so letter gaps in the banner stay clean. */
export function gradient(text: string, theme: Theme, terminal: Terminal, bold = false): string {
  if (!terminal.color) return text;
  const chars = [...text];
  const n = Math.max(1, chars.length - 1);
  let out = bold ? "\x1b[1m" : "";
  chars.forEach((ch, i) => {
    if (ch === " ") {
      out += " ";
      return;
    }
    const [r, g, b] = colorAt(theme.stops, i / n);
    out += `\x1b[38;2;${r};${g};${b}m${ch}`;
  });
  out += bold ? "\x1b[22;39m" : "\x1b[39m";
  return out;
}

/** A 5-row pixel font for the wordmark, uppercase only. */
const GLYPHS: Record<string, string[]> = {
  T: ["█████", "  █  ", "  █  ", "  █  ", "  █  "],
  O: [" ███ ", "█   █", "█   █", "█   █", " ███ "],
  K: ["█   █", "█  █ ", "███  ", "█  █ ", "█   █"],
  E: ["█████", "█    ", "████ ", "█    ", "█████"],
  N: ["█   █", "██  █", "█ █ █", "█  ██", "█   █"],
  F: ["█████", "█    ", "████ ", "█    ", "█    "],
  L: ["█    ", "█    ", "█    ", "█    ", "█████"],
  W: ["█   █", "█   █", "█ █ █", "██ ██", "█   █"],
};

/** Build the big gradient wordmark for the given text (letters must be in GLYPHS). */
function wordmark(text: string, theme: Theme, terminal: Terminal): string {
  const letters = [...text.toUpperCase()].filter((c) => GLYPHS[c]);
  const rows = [0, 1, 2, 3, 4].map((r) => letters.map((c) => GLYPHS[c]![r]).join(" "));
  return rows.map((row) => `  ${gradient(row, theme, terminal, true)}`).join("\n");
}

/**
 * The startup banner shown when the REPL opens. Returns "" when color is off (so
 * piped/dumb terminals see nothing). Falls back to a one-line gradient wordmark on
 * narrow terminals where the block art wouldn't fit.
 */
export function banner(theme: Theme, terminal: Terminal, columns = process.stdout.columns ?? 80): string {
  if (!terminal.color) return "";
  const tagline = paint("  ▸ your AI spend, measured live", theme.accent, terminal);
  if (columns < 56) {
    return `${gradient("TokenFlow", theme, terminal, true)}\n${tagline}\n`;
  }
  return `${wordmark("TokenFlow", theme, terminal)}\n${tagline}\n`;
}
