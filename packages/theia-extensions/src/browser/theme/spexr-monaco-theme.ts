import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { ACCENT } from "./spexr-accent.js";
import type { SpexrThemeKind } from "./spexr-theme-ids.js";
import { STATUS_GROUND_COLORS } from "./status-theme-data.js";

/**
 * The editor's colours, as the kit gives them. Every colour here is read from
 * `@sondalab/ui-kit/neutrals.json` (the `code-*` roles and the product's
 * neutrals) or from the kit's accent registry: there is no colour literal in
 * this file, and sl-audit would not see one (it reads CSS only).
 */
type Roles = (typeof kitNeutrals.products.spexr)["dark"];

const roles = (theme: SpexrThemeKind): Roles => kitNeutrals.products.spexr[theme];

/** The kit's syntax palette for a theme, by name. `null` and `boolean` resolve to the roles they alias. */
export interface CodeRoles {
  readonly fg: string;
  readonly comment: string;
  readonly keyword: string;
  readonly string: string;
  readonly number: string;
  readonly boolean: string;
  readonly function: string;
  readonly tag: string;
  readonly builtin: string;
}

/** The `code-*` roles of `products.spexr[theme]`. */
export function codeRoles(theme: SpexrThemeKind): CodeRoles {
  const r = roles(theme);
  return {
    fg: r["code-fg"],
    comment: r["code-comment"],
    keyword: r["code-keyword"],
    string: r["code-string"],
    number: r["code-number"],
    boolean: r["code-boolean"],
    function: r["code-function"],
    tag: r["code-tag"],
    builtin: r["code-builtin"],
  };
}

/** The surfaces and inks the editor sits on and draws with, from the same table. */
export function editorInks(theme: SpexrThemeKind): { surface: string; raised: string; primary: string; muted: string; accent: string } {
  const r = roles(theme);
  return { surface: r["bg-surface"], raised: r["bg-surface-raised"], primary: r["text-primary"], muted: r["text-muted"], accent: ACCENT[theme] };
}

/**
 * The current line's wash is the primary ink at 4.5%, a selection the accent
 * at 18% (the demo's `color-mix` values). Monaco takes `#rrggbbaa`, whose
 * alpha is a byte, and a byte is cut down, never rounded up: 4.5% is 0x0b
 * (4.3%, the byte Chrome paints for the demo too) and 18% is 0x2d (17.6%; 0x2e
 * is 18.0%). A wash no heavier than asked is what keeps the muted ink on a
 * selection at 4.5:1 where it sits closest: the dark comment on the lit
 * island's raised rung reads 4.496 with 0x2e and 4.56 with 0x2d.
 */
export const CURRENT_LINE_ALPHA = 0.045;
export const SELECTION_ALPHA = 0.18;
/** The other occurrences of the selected text, a lighter wash of the same accent. */
export const SELECTION_HIGHLIGHT_ALPHA = 0.1;

/** `#rrggbb` plus an alpha in 0-1, as `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
  return `${hex.toLowerCase()}${Math.floor(alpha * 255).toString(16).padStart(2, "0")}`;
}

/** The kit's translucent borders are `rgba(r,g,b,a)`; Monaco wants `#rrggbbaa`. */
export function rgbaToHex8(rgba: string): string {
  const [r, g, b, a] = (rgba.match(/[\d.]+/g) ?? []).map(Number);
  if (r === undefined || g === undefined || b === undefined || a === undefined) throw new Error(`not an rgba colour: ${rgba}`);
  return `#${[r, g, b, Math.round(a * 255)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

/** One TextMate token rule, in the shape of a VS Code colour theme's `tokenColors`. */
export interface TokenRule {
  readonly name: string;
  readonly scope: readonly string[];
  readonly settings: { readonly foreground: string; readonly fontStyle?: string };
}

/**
 * The syntax colours as TextMate rules. The demo paints five hues, by token
 * type: keyword, string, function, number and type (the kit's `builtin`),
 * with comments muted and italic, and everything else in the code ink. A rule
 * for a more specific scope wins over the broader one it sits in
 * (`keyword.operator` over `keyword`), so the operators and the arrow take the
 * code ink and `await`, `new` and `typeof` keep the keyword's.
 */
export function tokenColors(theme: SpexrThemeKind): TokenRule[] {
  const c = codeRoles(theme);
  const rule = (name: string, foreground: string, scope: string[], fontStyle?: string): TokenRule => ({
    name,
    scope,
    settings: fontStyle === undefined ? { foreground } : { foreground, fontStyle },
  });
  return [
    rule("Comment", c.comment, ["comment", "punctuation.definition.comment"], "italic"),
    rule("Keyword", c.keyword, [
      "keyword",
      "keyword.control",
      "keyword.operator.new",
      "keyword.operator.expression",
      "keyword.operator.delete",
      "keyword.operator.void",
      "storage",
      "storage.type",
      "storage.modifier",
    ]),
    rule("Operator and arrow", c.fg, ["keyword.operator", "storage.type.function.arrow"]),
    rule("String", c.string, ["string", "punctuation.definition.string", "string.regexp"]),
    rule("Template expression", c.fg, ["meta.template.expression", "punctuation.definition.template-expression"]),
    rule("Number", c.number, ["constant.numeric", "keyword.other.unit", "constant.character.escape"]),
    rule("Constant", c.boolean, ["constant.language"]),
    rule("Function", c.function, ["entity.name.function", "support.function", "support.type.property-name"]),
    rule("Type", c.builtin, [
      "entity.name.type",
      "entity.name.class",
      "entity.name.namespace",
      "entity.other.inherited-class",
      "support.type",
      "support.class",
    ]),
    rule("Tag", c.tag, ["entity.name.tag"]),
    rule("Attribute", c.function, ["entity.other.attribute-name"]),
    rule("Variable", c.fg, ["variable"]),
    rule("Markup heading", c.keyword, ["markup.heading", "entity.name.section"], "bold"),
    rule("Markup bold", c.fg, ["markup.bold"], "bold"),
    rule("Markup italic", c.fg, ["markup.italic"], "italic"),
    rule("Markup code", c.string, ["markup.inline.raw", "markup.fenced_code", "markup.raw"]),
    rule("Markup link", c.function, ["markup.underline.link", "string.other.link"]),
    rule("Markup quote", c.comment, ["markup.quote"], "italic"),
    rule("Diff inserted", c.string, ["markup.inserted"]),
    rule("Diff deleted", c.number, ["markup.deleted"]),
    rule("Diff changed", c.builtin, ["markup.changed"]),
  ];
}

/**
 * The editor's own colours for a theme: the surface and code ink, the current
 * line (the primary ink at 4.5%, with no border), the selection (the accent at
 * 18%, the same unfocused), the line numbers (muted, the current one in the
 * primary ink), the cursor in the accent and the indent guides in the kit's
 * hairlines. The ink and the accent are translucent washes, so they read over
 * whichever rung of the island the editor sits on.
 */
export function editorColors(theme: SpexrThemeKind): Record<string, string> {
  const r = roles(theme);
  const { surface, primary, muted, accent } = editorInks(theme);
  const selection = withAlpha(accent, SELECTION_ALPHA);
  const subtle = rgbaToHex8(r["border-subtle"]);
  const guide = rgbaToHex8(r["border-default"]);
  return {
    "editor.background": surface,
    "editor.foreground": r["code-fg"],
    "editorGutter.background": surface,
    "editor.lineHighlightBackground": withAlpha(primary, CURRENT_LINE_ALPHA),
    "editor.lineHighlightBorder": withAlpha(primary, 0),
    "editor.selectionBackground": selection,
    "editor.inactiveSelectionBackground": selection,
    "editor.selectionHighlightBackground": withAlpha(accent, SELECTION_HIGHLIGHT_ALPHA),
    "editorLineNumber.foreground": muted,
    "editorLineNumber.activeForeground": primary,
    "editorCursor.foreground": accent,
    "editorIndentGuide.background": subtle,
    "editorIndentGuide.activeBackground": guide,
    "editorIndentGuide.background1": subtle,
    "editorIndentGuide.activeBackground1": guide,
  };
}

/**
 * Theia's own colours for a theme, minus what spexr owns: the status grounds
 * (spexr-color-contribution.ts registers them) and the terminal's (the colour
 * registry holds spexr's; a theme's data would outrank it). Everything else of
 * the workbench keeps the value Theia's theme gives it.
 */
export function workbenchColors(base: Readonly<Record<string, string>>): Record<string, string> {
  const status = new Set<string>(STATUS_GROUND_COLORS);
  return Object.fromEntries(Object.entries(base).filter(([id]) => !status.has(id) && !id.startsWith("terminal.")));
}

/** A VS Code colour theme, as the Monaco theme registry takes it. */
export interface SpexrMonacoThemeJson {
  readonly name: string;
  readonly tokenColors: TokenRule[];
  readonly colors: Record<string, string>;
}

/**
 * The Monaco theme for `theme`: Theia's workbench colours as `base`, under the
 * kit's editor colours, with the kit's token colours and no others (the
 * built-in theme's own token rules are not included, so none of its blues is).
 */
export function monacoThemeJson(theme: SpexrThemeKind, name: string, base: Readonly<Record<string, string>> = {}): SpexrMonacoThemeJson {
  return { name, tokenColors: tokenColors(theme), colors: { ...workbenchColors(base), ...editorColors(theme) } };
}
