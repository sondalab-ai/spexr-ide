/**
 * The permission mode Claude Code's TUI shows in its footer, read from the
 * terminal's buffer. The transcript cannot say: Shift+Tab writes no record,
 * and the mode is saved to the file only at its creation, at size thresholds,
 * on compaction, resume and exit. The footer is the one place the current mode
 * is on screen, so this is best-effort text matching of an undocumented
 * interface: no match is "unknown", never a claim.
 */

export type FooterMode = "plan" | "acceptEdits" | "auto" | "bypass" | "manual" | "dontAsk";

export interface ModeFooter {
  readonly mode: FooterMode;
  /** The mode acts without asking (accept edits, auto, bypass): the person must know it is on. */
  readonly autoApprove: boolean;
}

/** The indicator strings, as the footer words them; the more specific first. */
const INDICATORS: ReadonlyArray<readonly [RegExp, FooterMode]> = [
  [/bypass permissions/i, "bypass"],
  [/accept edits/i, "acceptEdits"],
  [/auto mode/i, "auto"],
  [/plan mode/i, "plan"],
  [/manual mode/i, "manual"],
  [/don'?t ask/i, "dontAsk"],
];

/** The modes that act without asking. */
const AUTO_APPROVE: ReadonlySet<FooterMode> = new Set<FooterMode>(["bypass", "acceptEdits", "auto"]);

/** How many of the buffer's last lines hold the footer: it is at the foot of the TUI's screen. */
export const FOOTER_LINES = 8;

/**
 * The mode the footer shows in `lines` (the buffer's last few, in order): the
 * indicator on the lowest line that has one, since the footer is below the
 * conversation, which may mention a mode in its own words. The one earliest in
 * the table wins on a line that has several.
 */
export function parseModeFooter(lines: readonly string[]): ModeFooter | undefined {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    for (const [re, mode] of INDICATORS) {
      if (re.test(line)) return { mode, autoApprove: AUTO_APPROVE.has(mode) };
    }
  }
  return undefined;
}
