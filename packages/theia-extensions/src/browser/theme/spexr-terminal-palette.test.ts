import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { ACCENT, accentText } from "./spexr-accent.js";
import { contrastRatio } from "./contrast-util.js";
import { BRIGHT_MIX, TERMINAL_ANSI_IDS, mixHex, terminalColors } from "./spexr-terminal-palette.js";

const themes = ["dark", "light"] as const;
const require = createRequire(import.meta.url);

describe("the terminal's colours", () => {
  it("covers every ANSI id Theia's terminal registers, and no other", () => {
    const text = readFileSync(require.resolve("@theia/terminal/lib/common/terminal-preferences.js"), "utf8");
    const theia = [...text.matchAll(/'(terminal\.ansi[A-Za-z]+)': \{/g)].map((m) => m[1]);
    expect(theia).toHaveLength(16);
    expect([...theia].sort()).toEqual([...TERMINAL_ANSI_IDS].sort());
    for (const theme of themes) {
      for (const id of TERMINAL_ANSI_IDS) expect(terminalColors(theme)[id], `${theme} ${id}`).toBeDefined();
    }
  });

  it("lists the ids in xterm's order, so index i of the map is colour i", () => {
    const text = readFileSync(require.resolve("@theia/terminal/lib/common/terminal-preferences.js"), "utf8");
    const index = new Map([...text.matchAll(/'(terminal\.ansi[A-Za-z]+)': \{\s+index: (\d+)/g)].map((m) => [m[1]!, Number(m[2])]));
    expect(index.size).toBe(16);
    TERMINAL_ANSI_IDS.forEach((id, i) => expect(index.get(id), id).toBe(i));
  });

  it.each(themes)("%s: the hues are the kit's syntax hues and the greys its ink ladder", (theme) => {
    const r = kitNeutrals.products.spexr[theme];
    const colours = terminalColors(theme);
    expect(colours["terminal.ansiRed"]).toBe(r["code-number"]);
    expect(colours["terminal.ansiGreen"]).toBe(r["code-string"]);
    expect(colours["terminal.ansiYellow"]).toBe(r["code-builtin"]);
    expect(colours["terminal.ansiMagenta"]).toBe(r["code-keyword"]);
    expect(colours["terminal.ansiCyan"]).toBe(r["code-function"]);
    expect(colours["terminal.ansiBlue"]).toBe(accentText(theme));
    expect(colours["terminal.ansiWhite"]).toBe(r["text-secondary"]);
    expect(colours["terminal.ansiBrightWhite"]).toBe(r["text-primary"]);
    expect(colours["terminal.ansiBrightBlack"]).toBe(r["text-muted"]);
    expect(colours["terminal.foreground"]).toBe(r["text-secondary"]);
    expect(colours["terminalCursor.foreground"]).toBe(ACCENT[theme]);
    expect(colours["terminal.selectionBackground"]).toBe(`${ACCENT[theme]}2d`);
  });

  it("moves a bright hue 30% toward the primary ink", () => {
    expect(BRIGHT_MIX).toBe(0.3);
    expect(mixHex("#000000", "#ffffff", 0.3)).toBe("#4d4d4d");
    expect(mixHex("#102030", "#102030", 0.3)).toBe("#102030");
    for (const theme of themes) {
      const r = kitNeutrals.products.spexr[theme];
      expect(terminalColors(theme)["terminal.ansiBrightRed"]).toBe(mixHex(r["code-number"], r["text-primary"], BRIGHT_MIX));
    }
  });

  // Everything that can carry text reads on the terminal's ground, the surface
  // of an island at rest. Black is a ground colour (inverse text on a fill),
  // and on dark it is the tile rung: not text, so not held to the floor.
  it.each(themes)("%s: every colour that carries text reads at least 4.5:1 on the terminal ground", (theme) => {
    const colours = terminalColors(theme);
    const ground = kitNeutrals.products.spexr[theme]["bg-surface"];
    let min = Infinity;
    for (const id of ["terminal.foreground", ...TERMINAL_ANSI_IDS.filter((i) => i !== "terminal.ansiBlack")]) {
      const ratio = contrastRatio(colours[id]!, ground);
      expect(ratio, `${theme} ${id} ${colours[id]}`).toBeGreaterThanOrEqual(4.5);
      min = Math.min(min, ratio);
    }
    if (process.env.VERBOSE) console.info(`  min terminal contrast ${theme}: ${min.toFixed(2)}:1`);
  });

  it.each(themes)("%s: a bright colour reads at least as well as its plain one", (theme) => {
    const colours = terminalColors(theme);
    const ground = kitNeutrals.products.spexr[theme]["bg-surface"];
    for (const name of ["Red", "Green", "Yellow", "Blue", "Magenta", "Cyan"]) {
      expect(contrastRatio(colours[`terminal.ansiBright${name}`]!, ground), `${theme} ${name}`).toBeGreaterThanOrEqual(contrastRatio(colours[`terminal.ansi${name}`]!, ground));
    }
  });
});
