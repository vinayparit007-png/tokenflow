import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { createTerminal, type Terminal } from "../../src/cli/tty.js";
import { paint, gradient, banner, themeFor, themeNames, THEMES } from "../../src/cli/theme.js";

function term(color: boolean): Terminal {
  return createTerminal({ stdout: new PassThrough(), stderr: new PassThrough(), isTTY: color, forceColor: color });
}

// eslint-disable-next-line no-control-regex
const TRUECOLOR = /\x1b\[38;2;\d+;\d+;\d+m/;

describe("theme helpers respect the color gate (decision 6)", () => {
  it("paint is a no-op without color, truecolor with it", () => {
    expect(paint("hi", [10, 20, 30], term(false))).toBe("hi");
    expect(TRUECOLOR.test(paint("hi", [10, 20, 30], term(true)))).toBe(true);
  });

  it("gradient is plain without color and preserves spaces with it", () => {
    expect(gradient("a b", THEMES.aurora!, term(false))).toBe("a b");
    const colored = gradient("ab", THEMES.aurora!, term(true));
    expect(TRUECOLOR.test(colored)).toBe(true);
    // Text content survives (strip ANSI).
    // eslint-disable-next-line no-control-regex
    expect(colored.replace(/\x1b\[[0-9;]*m/g, "")).toBe("ab");
  });

  it("banner is empty without color and contains the wordmark art with it", () => {
    expect(banner(THEMES.aurora!, term(false))).toBe("");
    const art = banner(THEMES.aurora!, term(true), 100);
    expect(art).toContain("█");
    expect(TRUECOLOR.test(art)).toBe(true);
  });

  it("banner falls back to a compact wordmark on a narrow terminal", () => {
    const narrow = banner(THEMES.aurora!, term(true), 40);
    expect(narrow).not.toContain("█████"); // no block art
    expect(TRUECOLOR.test(narrow)).toBe(true);
  });
});

describe("themeFor", () => {
  it("returns the named theme", () => {
    expect(themeFor("neon").name).toBe("neon");
  });
  it("falls back to aurora for unknown or missing names", () => {
    expect(themeFor("nope").name).toBe("aurora");
    expect(themeFor(undefined).name).toBe("aurora");
  });
  it("exposes all theme names", () => {
    expect(themeNames()).toEqual(expect.arrayContaining(["aurora", "neon", "sunset", "matrix"]));
  });
});
