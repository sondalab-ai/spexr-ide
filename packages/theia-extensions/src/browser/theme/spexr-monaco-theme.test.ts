import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { ACCENT } from "./spexr-accent.js";
import { contrastRatio, over } from "./contrast-util.js";
import {
  CURRENT_LINE_ALPHA,
  SELECTION_ALPHA,
  codeRoles,
  editorColors,
  editorInks,
  monacoThemeJson,
  rgbaToHex8,
  tokenColors,
  withAlpha,
  workbenchColors,
} from "./spexr-monaco-theme.js";
import { STATUS_GROUND_COLORS } from "./status-theme-data.js";

const here = dirname(fileURLToPath(import.meta.url));
const themes = ["dark", "light"] as const;
const throws = (run: () => unknown): boolean => {
  try {
    run();
    return false;
  } catch {
    return true;
  }
};

/** The kit's `code-*` values for a theme, straight from the installed neutrals.json. */
const kitCode = (theme: "dark" | "light"): Set<string> =>
  new Set(Object.entries(kitNeutrals.products.spexr[theme]).filter(([role]) => role.startsWith("code-")).map(([, value]) => value as string));

describe("the Monaco theme's token colours", () => {
  it.each(themes)("%s: every token foreground is a kit code role", (theme) => {
    const rules = tokenColors(theme);
    expect(rules.length).toBeGreaterThan(10);
    const allowed = kitCode(theme);
    for (const rule of rules) {
      expect(allowed.has(rule.settings.foreground), `${rule.name}: ${rule.settings.foreground}`).toBe(true);
    }
  });

  it.each(themes)("%s: the demo's five hues, the comment and the code ink sit on the scopes a TextMate grammar gives those tokens", (theme) => {
    const roles = codeRoles(theme);
    const colour = (scope: string): string | undefined => tokenColors(theme).find((rule) => rule.scope.includes(scope))?.settings.foreground;
    expect(colour("keyword.control")).toBe(roles.keyword);
    expect(colour("storage.type")).toBe(roles.keyword);
    expect(colour("keyword.operator.new")).toBe(roles.keyword);
    expect(colour("string")).toBe(roles.string);
    expect(colour("entity.name.function")).toBe(roles.function);
    expect(colour("constant.numeric")).toBe(roles.number);
    expect(colour("constant.language")).toBe(roles.boolean);
    expect(colour("entity.name.type")).toBe(roles.builtin);
    expect(colour("support.type")).toBe(roles.builtin);
    expect(colour("entity.name.tag")).toBe(roles.tag);
    expect(colour("comment")).toBe(roles.comment);
    // the code ink takes the operators and the arrow back from the keyword rule they sit in
    expect(colour("keyword.operator")).toBe(roles.fg);
    expect(colour("storage.type.function.arrow")).toBe(roles.fg);
    expect(colour("variable")).toBe(roles.fg);
    // an object key (JSON, CSS) is a function hue, not the type's
    expect(colour("support.type.property-name")).toBe(roles.function);
  });

  it("makes the comment italic and nothing else in the demo's palette", () => {
    const italic = tokenColors("dark").filter((rule) => rule.settings.fontStyle === "italic").map((rule) => rule.name);
    expect(italic).toContain("Comment");
    expect(tokenColors("dark").find((rule) => rule.name === "Keyword")?.settings.fontStyle).toBeUndefined();
  });

  it("gives no scope two rules, so a scope has one colour", () => {
    for (const theme of themes) {
      const seen = new Set<string>();
      for (const scope of tokenColors(theme).flatMap((rule) => rule.scope)) {
        expect(seen.has(scope), `${theme}: ${scope}`).toBe(false);
        seen.add(scope);
      }
      expect(seen.size).toBeGreaterThan(30);
    }
  });
});

describe("the Monaco theme's editor colours", () => {
  it.each(themes)("%s: the current line is the primary ink at 4.5% and has no border", (theme) => {
    const colours = editorColors(theme);
    const { primary } = editorInks(theme);
    expect(colours["editor.lineHighlightBackground"]).toBe(`${primary}0b`);
    expect(colours["editor.lineHighlightBorder"]).toBe(`${primary}00`);
    // 0x0b/255 is the byte a browser paints for the demo's color-mix(…, 4.5%)
    expect(Math.floor(CURRENT_LINE_ALPHA * 255)).toBe(0x0b);
  });

  it.each(themes)("%s: the selection is the accent at 18%, focused or not", (theme) => {
    const colours = editorColors(theme);
    expect(colours["editor.selectionBackground"]).toBe(`${ACCENT[theme]}2d`);
    expect(colours["editor.inactiveSelectionBackground"]).toBe(colours["editor.selectionBackground"]);
    // cut down from 45.9, so the wash is never heavier than 18% (the demo paints 0x2e)
    expect(Math.floor(SELECTION_ALPHA * 255)).toBe(0x2d);
  });

  it.each(themes)("%s: line numbers are muted and the current one is the primary ink; the cursor is the accent", (theme) => {
    const colours = editorColors(theme);
    const r = kitNeutrals.products.spexr[theme];
    expect(colours["editorLineNumber.foreground"]).toBe(r["text-muted"]);
    expect(colours["editorLineNumber.activeForeground"]).toBe(r["text-primary"]);
    expect(colours["editorCursor.foreground"]).toBe(ACCENT[theme]);
    expect(colours["editor.foreground"]).toBe(r["code-fg"]);
    expect(colours["editor.background"]).toBe(r["bg-surface"]);
  });

  it("encodes the kit's rgba hairlines as #rrggbbaa", () => {
    expect(rgbaToHex8("rgba(20,22,27,0.08)")).toBe("#14161b14");
    expect(throws(() => rgbaToHex8("#14161b"))).toBe(true);
    expect(withAlpha("#8B96FF", 0.18)).toBe("#8b96ff2d");
    expect(throws(() => withAlpha("#8b96ff2e", 0.5))).toBe(true);
  });
});

describe("contrast of the editor's text on its grounds", () => {
  /**
   * The grounds an editor sits on: the island at rest and a lit island's
   * raised rung, each bare, under the current line's wash and under the
   * selection's. `stacked` adds the selection over the current line (a
   * selected current line), which the kit's gate does not cover.
   */
  const grounds = (theme: "dark" | "light", stacked = false): Array<[string, string]> => {
    const { surface, raised } = editorInks(theme);
    const colours = editorColors(theme);
    const out: Array<[string, string]> = [];
    for (const [name, base] of [["surface", surface], ["raised", raised]] as const) {
      const line = over(colours["editor.lineHighlightBackground"]!, base);
      const selection = over(colours["editor.selectionBackground"]!, base);
      out.push([name, base], [`${name} + current line`, line], [`${name} + selection`, selection]);
      if (stacked) out.push([`${name} + current line + selection`, over(colours["editor.selectionBackground"]!, line)]);
    }
    return out;
  };

  it.each(themes)("%s: every syntax hue, the code ink and the comment read at least 4.5:1 on every ground", (theme) => {
    const hues = codeRoles(theme);
    const gs = grounds(theme);
    expect(gs).toHaveLength(6);
    let min = Infinity;
    for (const [role, hex] of Object.entries(hues)) {
      for (const [ground, bg] of gs) {
        const ratio = contrastRatio(hex, bg);
        expect(ratio, `${theme} ${role} ${hex} on ${ground} ${bg}`).toBeGreaterThanOrEqual(4.5);
        min = Math.min(min, ratio);
      }
    }
    if (process.env.VERBOSE) console.info(`  min syntax contrast ${theme}: ${min.toFixed(2)}:1`);
  });

  // The selection over the current line is two washes: the muted ink (the
  // comment) is the tightest there, 4.3-4.5:1. Not gated at 4.5, as the kit's
  // own gate is single-wash; held at 4.0 so it cannot drift lower unseen.
  it.each(themes)("%s: a selected current line keeps every syntax hue at least 4.0:1", (theme) => {
    let min = Infinity;
    for (const [role, hex] of Object.entries(codeRoles(theme))) {
      for (const [ground, bg] of grounds(theme, true)) {
        const ratio = contrastRatio(hex, bg);
        expect(ratio, `${theme} ${role} on ${ground}`).toBeGreaterThanOrEqual(4.0);
        min = Math.min(min, ratio);
      }
    }
    if (process.env.VERBOSE) console.info(`  min stacked contrast ${theme}: ${min.toFixed(2)}:1`);
  });

  // the gutter carries no selection, so the numbers sit on the bare ground and the current line's wash
  it.each(themes)("%s: line numbers read at least 4.5:1, the current one on the current line's wash", (theme) => {
    const colours = editorColors(theme);
    for (const [ground, bg] of grounds(theme).filter(([name]) => !name.includes("selection"))) {
      expect(contrastRatio(colours["editorLineNumber.foreground"]!, bg), `${theme} muted on ${ground}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colours["editorLineNumber.activeForeground"]!, bg), `${theme} active on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(themes)("%s: a selection stays visible against its ground (a wash the demo's own 18%% makes about 1.1-1.4:1)", (theme) => {
    const colours = editorColors(theme);
    for (const base of [editorInks(theme).surface, editorInks(theme).raised]) {
      const ratio = contrastRatio(over(colours["editor.selectionBackground"]!, base), base);
      expect(ratio).toBeGreaterThan(1.1);
      if (process.env.VERBOSE) console.info(`  selection on ${base}: ${ratio.toFixed(2)}:1`);
    }
  });
});

describe("the Monaco theme as the registry takes it", () => {
  const base = { "activityBar.background": "x", "editor.background": "base", "terminal.inactiveSelectionBackground": "t", ...Object.fromEntries(STATUS_GROUND_COLORS.map((id) => [id, "s"])) };

  it("keeps Theia's workbench colours under the kit's editor colours, without the status grounds and the terminal's", () => {
    const json = monacoThemeJson("dark", "spexr-dark", base);
    expect(json.name).toBe("spexr-dark");
    expect(json.colors["activityBar.background"]).toBe("x");
    expect(json.colors["editor.background"]).toBe(kitNeutrals.products.spexr.dark["bg-surface"]);
    for (const id of STATUS_GROUND_COLORS) expect(json.colors[id], id).toBeUndefined();
    expect(Object.keys(json.colors).some((id) => id.startsWith("terminal."))).toBe(false);
    expect(Object.keys(workbenchColors(base))).toEqual(["activityBar.background", "editor.background"]);
  });

  it("has token colours of its own and none from the built-in theme", () => {
    const json = monacoThemeJson("light", "spexr-light", base);
    expect(json.tokenColors).toEqual(tokenColors("light"));
    expect(JSON.stringify(json)).not.toMatch(/include/);
  });

  it("is the same without a base: the editor colours alone", () => {
    expect(monacoThemeJson("light", "spexr-light").colors).toEqual(editorColors("light"));
  });
});

describe("no colour literal in the modules that draw the editor and the terminal", () => {
  const files = [
    "spexr-monaco-theme.ts",
    "spexr-terminal-palette.ts",
    "spexr-theme-ids.ts",
    "spexr-monaco-theme-contribution.ts",
    "../editor/spexr-editor-gutter.ts",
    "../editor/spexr-monaco-editor-provider.ts",
  ];
  /** Code, not comments: a hex, a functional colour, or a CSS colour name inside a string or number position. */
  const code = (file: string): string =>
    readFileSync(join(here, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("reads the files it scans", () => {
    for (const file of files) expect(code(file).length, file).toBeGreaterThan(100);
    // the two modules that hold colours do take them from the kit's table
    expect(code("spexr-monaco-theme.ts")).toMatch(/@sondalab\/ui-kit\/neutrals\.json/);
    expect(code("spexr-terminal-palette.ts")).toMatch(/@sondalab\/ui-kit\/neutrals\.json/);
  });

  it.each(files)("%s has no hex, rgb(), hsl() or oklch() colour", (file) => {
    const text = code(file);
    expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(text).not.toMatch(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/);
  });
});
