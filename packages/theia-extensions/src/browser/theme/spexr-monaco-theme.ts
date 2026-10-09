import kitNeutrals from "@sondalab/ui-kit/neutrals.json";
import { ACCENT, KIT_STATUS_TONES } from "./spexr-accent.js";
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
 * The washes, as the editor paints them. Monaco hands a colour to CSS with its
 * alpha at two decimals (`+(a).toFixed(2)`, vscode `color.js` formatRGBA), so
 * the alpha a wash paints at is its byte over 255 rounded to 0.01, not the
 * byte's own fraction: 0x2d and 0x2e both paint at 0.18. These are the alphas
 * painted, and {@link withAlpha} encodes the byte that paints them.
 *
 * - the current line is the primary ink at 4% (the demo's `color-mix` is 4.5%;
 *   Monaco cannot paint half a percent, so it is a level or two lighter);
 * - the selection is the accent at 17% (the demo's is 18%). The dark `comment`
 *   on the lit island's raised rung under an 18% selection is 4.496:1, under
 *   17% it is 4.62:1, so the selection is a point lighter than the demo's.
 */
export const CURRENT_LINE_ALPHA = 0.04;
export const SELECTION_ALPHA = 0.17;
/** The other occurrences of the selected text, and a word's occurrences: a lighter wash of the accent. */
export const SELECTION_HIGHLIGHT_ALPHA = 0.1;
/** A line or range the editor marks without a selection's weight (find range, a diff's inserted or removed line). */
export const FAINT_ALPHA = 0.06;
/** A diff's inserted or removed text: a tone at this alpha, under text that must still read at 4.5:1. */
export const DIFF_TEXT_ALPHA = 0.1;

/** The alpha CSS paints for a byte: Monaco's `toFixed(2)` of byte / 255. */
export function paintedAlpha(byte: number): number {
  return Math.round((byte / 255) * 100) / 100;
}

/** `#rrggbb` plus an alpha in 0-1, as `#rrggbbaa`. */
export function withAlpha(hex: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`not a #rrggbb colour: ${hex}`);
  return `${hex.toLowerCase()}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;
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
 * Bracket pair colours (an editor feature, off by default in spexr): three of
 * the kit's syntax hues in turn, and the number hue for a bracket with no
 * partner, in place of the gold, orchid and blue of Theia's theme.
 */
function bracketColors(theme: SpexrThemeKind): Record<string, string> {
  const c = codeRoles(theme);
  const levels = [c.builtin, c.keyword, c.function, c.builtin, c.keyword, c.function];
  return {
    ...Object.fromEntries(levels.map((hue, i) => [`editorBracketHighlight.foreground${i + 1}`, hue])),
    "editorBracketHighlight.unexpectedBracket.foreground": c.number,
  };
}

/**
 * The editor's severities in the kit's status tones, as the chrome's CSS
 * layer has them (`--slc-danger`, `--slc-warning`, `--slc-info`: from
 * {@link KIT_STATUS_TONES}, pinned to the installed kit by a test, because the
 * kit's stylesheets are not importable and a Monaco theme is data no
 * stylesheet reaches). Monaco draws a squiggle from `editorError.foreground`
 * and its kin, the overview ruler's marks and the gutter's change bars from
 * their own keys: added is the success tone, modified the warning, deleted
 * the danger.
 */
function severityColors(theme: SpexrThemeKind): Record<string, string> {
  const t = KIT_STATUS_TONES[theme];
  return {
    "editorError.foreground": t.danger,
    "editorWarning.foreground": t.warning,
    "editorInfo.foreground": t.info,
    "editorOverviewRuler.errorForeground": t.danger,
    "editorOverviewRuler.warningForeground": t.warning,
    "editorOverviewRuler.infoForeground": t.info,
    "editorOverviewRuler.addedForeground": t.success,
    "editorOverviewRuler.modifiedForeground": t.warning,
    "editorOverviewRuler.deletedForeground": t.danger,
    "editorGutter.addedBackground": t.success,
    "editorGutter.modifiedBackground": t.warning,
    "editorGutter.deletedBackground": t.danger,
  };
}

/**
 * Find, word highlight, the peek view and the diff editor, from kit roles:
 * the accent for what the editor looks at (find, a word's occurrences, the
 * peek view's frame and selected result), the surface rungs for the peek
 * view's grounds, the status tones for what a diff inserted and removed.
 * Every wash is light enough for the code hues to read on it at 4.5:1 (tested).
 */
function surfaceColors(theme: SpexrThemeKind): Record<string, string> {
  const { raised, primary, muted, accent } = editorInks(theme);
  const t = KIT_STATUS_TONES[theme];
  const selection = withAlpha(accent, SELECTION_ALPHA);
  const faint = withAlpha(accent, FAINT_ALPHA);
  const occurrence = withAlpha(accent, SELECTION_HIGHLIGHT_ALPHA);
  return {
    "editor.findMatchBackground": selection,
    "editor.findMatchBorder": accent,
    "editor.findMatchHighlightBackground": occurrence,
    "editor.findRangeHighlightBackground": faint,
    "editor.wordHighlightBackground": occurrence,
    "editor.wordHighlightStrongBackground": selection,
    "editorOverviewRuler.findMatchForeground": accent,
    "editorOverviewRuler.selectionHighlightForeground": accent,
    "editorOverviewRuler.wordHighlightForeground": accent,
    "editorOverviewRuler.wordHighlightStrongForeground": accent,
    "editorOverviewRuler.bracketMatchForeground": accent,
    "peekView.border": accent,
    "peekViewEditor.background": raised,
    "peekViewEditorGutter.background": raised,
    "peekViewEditor.matchHighlightBackground": selection,
    "peekViewResult.background": raised,
    "peekViewResult.selectionBackground": selection,
    "peekViewResult.selectionForeground": primary,
    "peekViewResult.matchHighlightBackground": selection,
    "peekViewTitle.background": raised,
    "peekViewTitleLabel.foreground": primary,
    "peekViewTitleDescription.foreground": muted,
    "diffEditor.insertedTextBackground": withAlpha(t.success, DIFF_TEXT_ALPHA),
    "diffEditor.removedTextBackground": withAlpha(t.danger, DIFF_TEXT_ALPHA),
    "diffEditor.insertedLineBackground": withAlpha(t.success, FAINT_ALPHA),
    "diffEditor.removedLineBackground": withAlpha(t.danger, FAINT_ALPHA),
    "diffEditorGutter.insertedLineBackground": withAlpha(t.success, DIFF_TEXT_ALPHA),
    "diffEditorGutter.removedLineBackground": withAlpha(t.danger, DIFF_TEXT_ALPHA),
    "diffEditorOverview.insertedForeground": t.success,
    "diffEditorOverview.removedForeground": t.danger,
  };
}

/**
 * Keys of the editor's colours that spexr leaves to Theia's theme on purpose:
 * a hover's highlight, whitespace marks, code lens and inlay hints, snippet
 * tab stops, the merge editor's and the unfocused-selection rulers' colours,
 * and the fold and link marks. None is in the demo; each is a quiet mark that
 * a kit role would only make louder. A test pins that none is overridden here.
 */
export const INHERITED_ON_PURPOSE = [
  "editor.hoverHighlightBackground",
  "editorWhitespace.foreground",
  "editorCodeLens.foreground",
  "editorInlayHint.foreground",
  "editor.snippetTabstopHighlightBackground",
  "editor.foldBackground",
  "editorRuler.foreground",
  "editorOverviewRuler.currentContentForeground",
  "editorOverviewRuler.incomingContentForeground",
  "editorOverviewRuler.commonContentForeground",
] as const;

/**
 * The editor's own colours for a theme: the surface and code ink, the current
 * line (the primary ink at 4%, with no border), the selection (the accent at
 * 17%, the same unfocused; a matched bracket the same wash), the line numbers
 * (muted, the current one in the primary ink), the cursor in the accent, the
 * indent guides in the kit's hairlines, then the severities, find, peek view
 * and diff colours. The ink and the accent are translucent washes, so they
 * read over whichever rung of the island the editor sits on.
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
    ...severityColors(theme),
    ...surfaceColors(theme),
    "editorBracketMatch.background": selection,
    "editorBracketMatch.border": withAlpha(accent, 0),
    ...bracketColors(theme),
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
