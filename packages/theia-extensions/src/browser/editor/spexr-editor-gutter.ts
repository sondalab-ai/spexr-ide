/**
 * The editor's gutter, as the Lumen demo draws it: line numbers right-aligned
 * to 38px from the editor's left edge and the text starting at 56px (the
 * demo's `.ide-code__no` is 56px wide with 18px of padding on its right).
 *
 * Monaco lays the gutter out as: line numbers (the wider of the digit count
 * and `lineNumbersMinChars`, times the widest digit), then the line
 * decorations (`lineDecorationsWidth`, plus 16px when folding is on), then
 * the text. With no glyph margin the numbers end at their width and the text
 * starts after the decorations. The widths are whole pixels (Monaco rounds
 * the numbers' width), so the demo's 38 is met within a pixel.
 */
export const DEMO_GUTTER = { numbersRight: 38, contentLeft: 56 } as const;

/** How far the gutter may be from the demo's, in px (the plan's "within 1-2 px"). */
export const GUTTER_TOLERANCE_PX = 2;

/**
 * The advance of one Geist Mono character as a fraction of the font size: the
 * demo's 42-character line is 327.67px wide at 13px, 7.8px a character. The
 * digits share that advance, so five of them are 39px.
 */
export const GEIST_MONO_ADVANCE_EM = 0.6;

/** The two Monaco options the gutter is tuned with (not Theia preferences, so set when an editor is created). */
export const SPEXR_GUTTER_OPTIONS = { lineNumbersMinChars: 5, lineDecorationsWidth: 1 } as const;

/** The width Monaco adds to the decorations for the folding controls. */
export const MONACO_FOLDING_WIDTH = 16;

/** What the editor's options and font make the gutter, in px from the editor's left edge. */
export interface GutterInput {
  readonly digitWidth: number;
  /** The digits of the highest line number. */
  readonly digits: number;
  readonly lineNumbersMinChars: number;
  readonly lineDecorationsWidth: number;
  readonly folding: boolean;
  /** The glyph margin's width: 0 when it is off (the lane count times the line height when on). */
  readonly glyphMarginWidth: number;
}

/** Where the line numbers end and the text starts. A port of Monaco's layout, `EditorLayoutInfoComputer`. */
export function gutterLayout(input: GutterInput): { numbersRight: number; contentLeft: number } {
  const numbersWidth = Math.round(Math.max(input.digits, input.lineNumbersMinChars) * input.digitWidth);
  const decorations = input.lineDecorationsWidth + (input.folding ? MONACO_FOLDING_WIDTH : 0);
  const numbersRight = input.glyphMarginWidth + numbersWidth;
  return { numbersRight, contentLeft: numbersRight + decorations };
}
