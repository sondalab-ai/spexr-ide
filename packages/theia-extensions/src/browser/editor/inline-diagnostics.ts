/**
 * The editor's inline diagnostics (S6k, D23), free of Monaco and Theia: which
 * markers get a message after their line, and what it says. Lumen shows a
 * line's warning or error as a small chip after the code
 * (`cache.write(probe.key, answer);  Promise returned is not awaited`).
 */

/** A marker as the problem manager holds it: the 1-based line is derived by the caller. */
export interface InlineMarker {
  /** 1-based line of the marker's start. */
  readonly line: number;
  /** LSP severity: 1 error, 2 warning, 3 information, 4 hint. */
  readonly severity: number | undefined;
  readonly message: string;
}

export type InlineTone = "error" | "warning";

export interface InlineDiagnostic {
  readonly line: number;
  readonly tone: InlineTone;
  /** One line of plain text, cut with an ellipsis to fit. */
  readonly text: string;
}

/** The longest message ever shown, however wide the editor is. */
export const INLINE_MAX_CHARS = 120;
/** The columns the chip's margin, padding and the ellipsis take beside its text (24 + 16 px of the mono's ~7.8). */
export const INLINE_CHROME_COLS = 6;
/** Fewest message columns worth showing: with less room the line is left alone. */
export const INLINE_MIN_COLS = 10;

/** The tone of an LSP severity: only errors and warnings are shown inline. */
export function toneOf(severity: number | undefined): InlineTone | undefined {
  return severity === 1 ? "error" : severity === 2 ? "warning" : undefined;
}

/**
 * A message as one line of at most `max` characters: its first line, spaces
 * collapsed, cut with an ellipsis. The text is only ever drawn as text, never
 * as markup, so nothing in a message can be anything else.
 */
export function truncateMessage(message: string, max: number): string {
  const one = (message.split(/\r?\n/)[0] ?? "").replace(/\s+/g, " ").trim();
  if (max < 1) return "";
  if (one.length <= max) return one;
  return `${one.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export interface InlineLayout {
  /** How many columns of code a line of the editor holds before it wraps. */
  readonly columns: number;
  /** The length of a 1-based line, in characters. */
  lineLength(line: number): number;
}

/**
 * One diagnostic per line, the most severe (an error over a warning, then the
 * first reported), cut to the room the line has left: `columns` less the
 * line's own length and the chip's chrome. A line with no room for
 * {@link INLINE_MIN_COLS} columns of message gets none, rather than wrapping
 * the code below it. Lines come back in order.
 */
export function inlineDiagnostics(markers: readonly InlineMarker[], layout: InlineLayout): InlineDiagnostic[] {
  const best = new Map<number, { tone: InlineTone; message: string; severity: number }>();
  for (const m of markers) {
    const tone = toneOf(m.severity);
    if (!tone || m.line < 1 || !m.message.trim()) continue;
    const held = best.get(m.line);
    if (!held || m.severity! < held.severity) best.set(m.line, { tone, message: m.message, severity: m.severity! });
  }
  const out: InlineDiagnostic[] = [];
  for (const [line, { tone, message }] of [...best].sort((a, b) => a[0] - b[0])) {
    const room = layout.columns - layout.lineLength(line) - INLINE_CHROME_COLS;
    if (room < INLINE_MIN_COLS) continue;
    const text = truncateMessage(message, Math.min(INLINE_MAX_CHARS, room));
    if (text) out.push({ line, tone, text });
  }
  return out;
}

/** The class a chip wears: the shared one and its tone's. */
export const INLINE_CLASS = "spexr-inline-diag";
export const inlineClass = (tone: InlineTone): string => `${INLINE_CLASS} ${INLINE_CLASS}--${tone}`;
