/**
 * The permission mode Claude Code's TUI shows in its footer, read from the
 * terminal's buffer. The transcript cannot say: Shift+Tab writes no record,
 * and the mode is saved to the file only at its creation, at size thresholds,
 * on compaction, resume and exit. The footer is the one place the current mode
 * is on screen, so this is best-effort matching of an undocumented interface:
 * no match is "unknown", never a claim.
 *
 * The footer's format, from Claude Code 2.1.296's mode table: a symbol
 * (`⏸` for manual and plan, `⏵⏵` for accept edits, auto, don't ask and bypass),
 * a space, the mode's indicator, and ` on` (left out in the compact layout):
 * `⏸ plan mode on (shift+tab to cycle)`. The default (manual) mode shows no
 * footer line at all. Only a row that starts with the symbol and an indicator
 * counts, so prose that mentions a mode, or a dialog's "don't ask again",
 * never does.
 */

export type FooterMode = "plan" | "acceptEdits" | "auto" | "bypass" | "dontAsk";

export interface ModeFooter {
  readonly kind: "mode";
  readonly mode: FooterMode;
  /** The mode acts without asking (accept edits, auto, bypass): the person must know it is on. */
  readonly autoApprove: boolean;
}

/** Nothing known: the agent shows no mode line (the default mode), or a dialog or a screen covers the footer. */
export interface ModeUnknown {
  readonly kind: "unknown";
}

export type ModeReading = ModeFooter | ModeUnknown;

const FOOTER = /^\s*(?:⏸|⏵⏵)\s+(plan mode|accept edits|auto mode|bypass permissions|don't ask)(?:\s+on)?(?:\s*[(\u00b7].*)?\s*$/i;

const MODES: Readonly<Record<string, FooterMode>> = {
  "plan mode": "plan",
  "accept edits": "acceptEdits",
  "auto mode": "auto",
  "bypass permissions": "bypass",
  "don't ask": "dontAsk",
};

/** The modes that act without asking. */
const AUTO_APPROVE: ReadonlySet<FooterMode> = new Set<FooterMode>(["bypass", "acceptEdits", "auto"]);

/** How many non-blank rows from the bottom hold the footer: it is the TUI's last line or two. */
export const FOOTER_ROWS = 3;

/** The last {@link FOOTER_ROWS} non-blank rows of `lines`, in order: blank rows under the TUI are not the footer's place. */
export function lastRows(lines: readonly string[]): string[] {
  return lines.filter((l) => l.trim() !== "").slice(-FOOTER_ROWS);
}

/**
 * The mode the footer shows in `rows` (the last non-blank rows of the buffer):
 * the lowest row that has a footer, since the footer is below everything else.
 */
export function parseModeFooter(rows: readonly string[]): ModeReading {
  for (let i = rows.length - 1; i >= 0; i--) {
    const m = FOOTER.exec(rows[i]!);
    if (m) {
      const mode = MODES[m[1]!.toLowerCase()]!;
      return { kind: "mode", mode, autoApprove: AUTO_APPROVE.has(mode) };
    }
  }
  return { kind: "unknown" };
}
