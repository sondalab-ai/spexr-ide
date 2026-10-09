import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { ACCENT, KIT_STATUS_TONES } from "./spexr-accent.js";
import { contrastRatio, over } from "./contrast-util.js";
import {
  CURRENT_LINE_ALPHA,
  DIFF_TEXT_ALPHA,
  FAINT_ALPHA,
  INHERITED_ON_PURPOSE,
  SELECTION_ALPHA,
  SELECTION_HIGHLIGHT_ALPHA,
  codeRoles,
  editorColors,
  editorInks,
  monacoThemeJson,
  paintedAlpha,
  rgbaToHex8,
  tokenColors,
  withAlpha,
  workbenchColors,
} from "./spexr-monaco-theme.js";
import { STATUS_GROUND_COLORS } from "./status-theme-data.js";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
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
  it.each(themes)("%s: the current line is the primary ink painted at 4% and has no border", (theme) => {
    const colours = editorColors(theme);
    const { primary } = editorInks(theme);
    expect(colours["editor.lineHighlightBackground"]).toBe(`${primary}0a`);
    expect(colours["editor.lineHighlightBorder"]).toBe(`${primary}00`);
    expect(paintedAlpha(0x0a)).toBe(CURRENT_LINE_ALPHA);
  });

  it.each(themes)("%s: the selection is the accent painted at 17%, focused or not", (theme) => {
    const colours = editorColors(theme);
    expect(colours["editor.selectionBackground"]).toBe(`${ACCENT[theme]}2b`);
    expect(colours["editor.inactiveSelectionBackground"]).toBe(colours["editor.selectionBackground"]);
    expect(paintedAlpha(0x2b)).toBe(SELECTION_ALPHA);
  });

  // Monaco writes CSS alpha as +(a).toFixed(2) (color.js formatRGBA), so a byte
  // paints at its fraction rounded to two decimals: every wash must paint at
  // the alpha it is named for, and the model is read from the installed Monaco.
  it("pins the alpha each wash paints at to Monaco's two-decimal CSS alpha", () => {
    const color = readFileSync(require.resolve("@theia/monaco-editor-core/esm/vs/base/common/color.js"), "utf8");
    expect(color).toMatch(/\$\{\+\(color\.rgba\.a\)\.toFixed\(2\)\}/);
    expect([0x2d, 0x2e].map(paintedAlpha)).toEqual([0.18, 0.18]);
    expect([0x2b, 0x2c].map(paintedAlpha)).toEqual([0.17, 0.17]);
    for (const [name, alpha] of Object.entries({ CURRENT_LINE_ALPHA, SELECTION_ALPHA, SELECTION_HIGHLIGHT_ALPHA, FAINT_ALPHA, DIFF_TEXT_ALPHA })) {
      const byte = parseInt(withAlpha("#000000", alpha).slice(7), 16);
      expect(paintedAlpha(byte), name).toBe(alpha);
    }
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

  it.each(themes)("%s: a bracket pair takes kit syntax hues, and a matched bracket the selection's wash with no border", (theme) => {
    const colours = editorColors(theme);
    const allowed = kitCode(theme);
    const levels = Object.keys(colours).filter((id) => id.startsWith("editorBracketHighlight."));
    expect(levels).toHaveLength(7);
    for (const id of levels) expect(allowed.has(colours[id]!), `${id} ${colours[id]}`).toBe(true);
    expect(colours["editorBracketMatch.background"]).toBe(colours["editor.selectionBackground"]);
    expect(colours["editorBracketMatch.border"]).toBe(`${editorInks(theme).accent}00`);
  });

  it.each(themes)("%s: the squiggles, ruler marks and gutter change bars are the kit's status tones", (theme) => {
    const colours = editorColors(theme);
    const t = KIT_STATUS_TONES[theme];
    expect(colours["editorError.foreground"]).toBe(t.danger);
    expect(colours["editorWarning.foreground"]).toBe(t.warning);
    expect(colours["editorInfo.foreground"]).toBe(t.info);
    expect(colours["editorOverviewRuler.errorForeground"]).toBe(t.danger);
    expect(colours["editorOverviewRuler.warningForeground"]).toBe(t.warning);
    expect(colours["editorOverviewRuler.infoForeground"]).toBe(t.info);
    expect(colours["editorOverviewRuler.addedForeground"]).toBe(t.success);
    expect(colours["editorGutter.addedBackground"]).toBe(t.success);
    expect(colours["editorGutter.modifiedBackground"]).toBe(t.warning);
    expect(colours["editorGutter.deletedBackground"]).toBe(t.danger);
  });

  it.each(themes)("%s: find, word highlight, peek view and diff colours come from the accent, the surface rungs and the status tones", (theme) => {
    const colours = editorColors(theme);
    const { raised, accent } = editorInks(theme);
    const t = KIT_STATUS_TONES[theme];
    expect(colours["editor.findMatchBorder"]).toBe(accent);
    expect(colours["peekView.border"]).toBe(accent);
    for (const id of ["peekViewEditor.background", "peekViewResult.background", "peekViewTitle.background"]) expect(colours[id], id).toBe(raised);
    expect(colours["editor.wordHighlightBackground"]).toBe(withAlpha(accent, SELECTION_HIGHLIGHT_ALPHA));
    expect(colours["diffEditor.insertedTextBackground"]).toBe(withAlpha(t.success, DIFF_TEXT_ALPHA));
    expect(colours["diffEditor.removedTextBackground"]).toBe(withAlpha(t.danger, DIFF_TEXT_ALPHA));
  });

  it("leaves the quiet editor marks to Theia's theme on purpose, and says which", () => {
    expect(INHERITED_ON_PURPOSE.length).toBeGreaterThan(5);
    for (const theme of themes) {
      const colours = editorColors(theme);
      for (const id of INHERITED_ON_PURPOSE) expect(id in colours, `${theme} ${id}`).toBe(false);
    }
  });

  it("encodes the kit's rgba hairlines as #rrggbbaa", () => {
    expect(rgbaToHex8("rgba(20,22,27,0.08)")).toBe("#14161b14");
    expect(throws(() => rgbaToHex8("#14161b"))).toBe(true);
    expect(withAlpha("#8B96FF", 0.17)).toBe("#8b96ff2b");
    expect(throws(() => withAlpha("#8b96ff2b", 0.5))).toBe(true);
  });
});

describe("contrast of the editor's text on its grounds", () => {
  /**
   * The grounds an editor sits on: the island at rest and a lit island's
   * raised rung, each bare, under the current line's wash and under the
   * selection's, as painted (alpha at two decimals). The selection never
   * stacks on the current line in the content: Monaco paints that wash only
   * with a single empty selection (currentLineHighlight `_shouldRenderInContent`).
   */
  const grounds = (theme: "dark" | "light"): Array<[string, string]> => {
    const { surface, raised } = editorInks(theme);
    const colours = editorColors(theme);
    const out: Array<[string, string]> = [];
    for (const [name, base] of [["surface", surface], ["raised", raised]] as const) {
      out.push([name, base], [`${name} + current line`, over(colours["editor.lineHighlightBackground"]!, base)], [`${name} + selection`, over(colours["editor.selectionBackground"]!, base)]);
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

  // A squiggle, a ruler mark and a change bar are indicators: 3:1 is their
  // floor; the hues are text-grade, so they clear it by a wide margin.
  it.each(themes)("%s: severity squiggles and change bars read at least 3:1 on every ground", (theme) => {
    const colours = editorColors(theme);
    const ids = Object.keys(colours).filter((id) => /^(editor(Error|Warning|Info)\.foreground|editorOverviewRuler\.(error|warning|info|added|modified|deleted)Foreground|editorGutter\.(added|modified|deleted)Background)$/.test(id));
    expect(ids).toHaveLength(12);
    let min = Infinity;
    for (const id of ids) {
      for (const [ground, bg] of grounds(theme)) {
        const ratio = contrastRatio(colours[id]!, bg);
        expect(ratio, `${theme} ${id} on ${ground}`).toBeGreaterThanOrEqual(3);
        min = Math.min(min, ratio);
      }
    }
    if (process.env.VERBOSE) console.info(`  min severity contrast ${theme}: ${min.toFixed(2)}:1`);
  });

  // Find, word highlight, the peek view's selection and the diff washes sit
  // under code text too: every code hue must still read on each.
  it.each(themes)("%s: every syntax hue reads at least 4.5:1 under the find, word, peek and diff washes", (theme) => {
    const colours = editorColors(theme);
    const washes = ["editor.findMatchBackground", "editor.findMatchHighlightBackground", "editor.findRangeHighlightBackground", "editor.wordHighlightBackground", "editor.wordHighlightStrongBackground", "peekViewResult.selectionBackground", "diffEditor.insertedTextBackground", "diffEditor.removedTextBackground", "diffEditor.insertedLineBackground", "diffEditor.removedLineBackground", "editorBracketMatch.background"];
    let min = Infinity;
    for (const id of washes) {
      for (const base of [editorInks(theme).surface, editorInks(theme).raised]) {
        const ground = over(colours[id]!, base);
        for (const [role, hex] of Object.entries(codeRoles(theme))) {
          const ratio = contrastRatio(hex, ground);
          expect(ratio, `${theme} ${role} under ${id} on ${base}`).toBeGreaterThanOrEqual(4.5);
          min = Math.min(min, ratio);
        }
      }
    }
    if (process.env.VERBOSE) console.info(`  min under washes ${theme}: ${min.toFixed(2)}:1`);
  });

  // the gutter carries no selection, so the numbers sit on the bare ground and the current line's wash
  it.each(themes)("%s: line numbers read at least 4.5:1, the current one on the current line's wash", (theme) => {
    const colours = editorColors(theme);
    for (const [ground, bg] of grounds(theme).filter(([name]) => !name.includes("selection"))) {
      expect(contrastRatio(colours["editorLineNumber.foreground"]!, bg), `${theme} muted on ${ground}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(colours["editorLineNumber.activeForeground"]!, bg), `${theme} active on ${ground}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(themes)("%s: a selection stays visible against its ground (a 17%% wash is about 1.1-1.4:1)", (theme) => {
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
