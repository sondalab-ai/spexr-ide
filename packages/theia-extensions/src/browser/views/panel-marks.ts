/**
 * The kit's eyebrow glyphs (ui-kit 0.42). '' is the bare `.sl-eyebrow--mark`
 * (a quarter disc and a bar); the others name the modifier worn with it.
 */
export const PANEL_MARK_GLYPHS = ["", "square", "tri", "circle", "half", "stair"] as const;
export type PanelMarkGlyph = (typeof PANEL_MARK_GLYPHS)[number];

/**
 * The glyph on each right-island view's head, in tab order (agent, memory,
 * experts, todo). Fixed per view rather than per position, so a view keeps its
 * glyph when the tabs move, and no two views share one.
 */
export const PANEL_MARKS = {
  agent: "",
  memory: "square",
  experts: "circle",
  todo: "tri",
} as const satisfies Record<string, PanelMarkGlyph>;
export type PanelMarkKey = keyof typeof PANEL_MARKS;

/**
 * The eyebrow classes for a view's head: the eyebrow, the mark, and the glyph
 * modifier when the view's glyph is not the bare one.
 */
export function panelMarkClass(key: PanelMarkKey): string {
  const glyph: PanelMarkGlyph = PANEL_MARKS[key];
  return glyph ? `sl-eyebrow sl-eyebrow--mark sl-eyebrow--mark-${glyph}` : "sl-eyebrow sl-eyebrow--mark";
}
