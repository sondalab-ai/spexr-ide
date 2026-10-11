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
  /** The whole message, for the hover (shown as plain text). */
  readonly full: string;
}

/** The longest message ever shown, however wide the editor is. */
export const INLINE_MAX_CHARS = 120;
/** The columns the chip's margin, padding and the ellipsis take beside its text (24 + 16 px of the mono's ~7.8). */
export const INLINE_CHROME_COLS = 6;
/** Fewest message columns worth showing: with less room the line is left alone. */
export const INLINE_MIN_COLS = 10;

/**
 * The tone of an LSP severity: only errors and warnings are shown inline. A
 * marker with no severity is an error, which is what LSP says a client may
 * assume.
 */
export function toneOf(severity: number | undefined): InlineTone | undefined {
  return severity === undefined || severity === 1 ? "error" : severity === 2 ? "warning" : undefined;
}

/**
 * What a message must not carry into the editor: control characters, the
 * bidirectional overrides and marks (U+202A-202E, U+2066-2069, LRM, RLM, ALM),
 * the zero-width characters (U+200B-200D, U+2060, U+FEFF) and the line and
 * paragraph separators (U+2028, U+2029).
 */
const UNSAFE = /[\p{Cc}\u202a-\u202e\u2066-\u2069\u200b-\u200f\u061c\u2028\u2029\u2060\ufeff]/gu;

/** Whether a code point is drawn two columns wide: CJK, Hangul, fullwidth forms, emoji. */
export function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/**
 * The columns a line of code takes: a tab goes to the next multiple of
 * `tabSize`, a wide character is two columns. Used where the editor cannot
 * measure the rendered line (the chip's room is then an estimate). With `cap`
 * the scan stops at that many columns (the editor's width).
 */
export function displayWidth(text: string, tabSize: number, cap = Infinity): number {
  let col = 0;
  for (const ch of text) {
    if (ch === "\t") col += tabSize - (col % tabSize);
    else col += isWide(ch.codePointAt(0)!) ? 2 : 1;
    // A line already wider than the editor leaves no room whatever its length: the scan stops there.
    if (col >= cap) return col;
  }
  return col;
}

/**
 * A message as the hover shows it: a plain-text code block, fenced with more
 * backticks than any run in the message, so nothing in it can close the block
 * and nothing is read as Markdown.
 */
export const HOVER_MAX_CHARS = 2000;

export function plainTextBlock(message: string): string {
  const shown = Array.from(message);
  message = shown.length > HOVER_MAX_CHARS ? `${shown.slice(0, HOVER_MAX_CHARS).join("")}\u2026` : message;
  const longest = Math.max(0, ...(message.match(/`+/g) ?? []).map((r) => r.length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}text\n${message.replace(UNSAFE_KEEP_NEWLINE, "")}\n${fence}`;
}
const UNSAFE_KEEP_NEWLINE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;

/** Within this many columns of the cut, a space is a better place to end than the middle of a word. */
const WORD_WINDOW = 8;

/**
 * A message as one line of at most `max` columns: its first line after
 * trimming, spaces collapsed, unsafe characters (UNSAFE) taken out, cut with an
 * ellipsis. Width is counted as the editor counts it: a wide character (CJK,
 * emoji) is two columns, and a cut is by code points, never inside a
 * surrogate pair. The cut falls on a space when one lies within the last
 * {@link WORD_WINDOW} columns. The text is only ever drawn as text, never as markup.
 */
export function truncateMessage(message: string, max: number): string {
  if (max < 1) return "";
  const first = (message.trim().split(/\r?\n/)[0] ?? "").replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(first);
  const width = (cs: readonly string[]): number => cs.reduce((n, c) => n + (isWide(c.codePointAt(0)!) ? 2 : 1), 0);
  if (width(chars) <= max) return first;
  // Room for the ellipsis (one column).
  let keep = 0;
  let used = 0;
  while (keep < chars.length) {
    const w = isWide(chars[keep]!.codePointAt(0)!) ? 2 : 1;
    if (used + w > max - 1) break;
    used += w;
    keep++;
  }
  let cut = chars.slice(0, keep);
  const space = cut.lastIndexOf(" ");
  if (space > 0 && width(cut.slice(space)) <= WORD_WINDOW) cut = cut.slice(0, space);
  return `${cut.join("").trimEnd()}\u2026`;
}

export interface InlineLayout {
  /** How many columns of code a line of the editor holds before it wraps. */
  readonly columns: number;
  /** The lines the file has: a marker past it (stale, or a file that shrank) is not drawn. */
  readonly lineCount: number;
  /** The columns a 1-based line takes (tabs expanded, wide characters counted twice). */
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
    if (!tone || m.line < 1 || m.line > layout.lineCount || !m.message.trim()) continue;
    const severity = m.severity ?? 1;
    const held = best.get(m.line);
    if (!held || severity < held.severity) best.set(m.line, { tone, message: m.message, severity });
  }
  const out: InlineDiagnostic[] = [];
  for (const [line, { tone, message }] of [...best].sort((a, b) => a[0] - b[0])) {
    const room = layout.columns - layout.lineLength(line) - INLINE_CHROME_COLS;
    if (room < INLINE_MIN_COLS) continue;
    const text = truncateMessage(message, Math.min(INLINE_MAX_CHARS, room));
    if (text) out.push({ line, tone, text, full: message });
  }
  return out;
}

/** The class a chip wears: the shared one and its tone's. */
export const INLINE_CLASS = "spexr-inline-diag";
export const inlineClass = (tone: InlineTone): string => `${INLINE_CLASS} ${INLINE_CLASS}--${tone}`;
