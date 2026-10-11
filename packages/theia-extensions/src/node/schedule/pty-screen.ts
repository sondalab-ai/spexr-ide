import { bracketedPaste } from "../../common/terminal-paste.js";

/**
 * What a scheduled task's pty shows, read from its raw output, so the runner's
 * unattended Enter is pressed only on an idle input prompt. Tasks are
 * interactive `claude` sessions in a backend pty, and an Enter that lands on a
 * dialog accepts it, so the follow-up's Enter fails closed: with no idle prompt
 * on screen, or any dialog chrome, nothing is pressed and the task needs the
 * user. The screen is approximated by the output's tail with the escape
 * sequences stripped (there is no terminal emulator in the backend), which is
 * enough to tell a prompt from a dialog and never to claim one it cannot see.
 */

/** How much of a pty's output is kept for the screen, in characters. */
export const SCREEN_TAIL_CHARS = 16_384;
/** How many non-blank rows from the bottom are looked at. */
export const SCREEN_ROWS = 12;

/** The output with CSI, OSC and other escape sequences, and bare carriage returns, taken out. */
export function stripAnsi(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?<>=]*[ -/]*[@-~]/g, "\n")
    .replace(/\x1b[()][0-9A-Za-z]/g, "")
    .replace(/\x1b[@-Z\\-_=>]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/** The last non-blank rows of `raw`, in order. */
export function screenRows(raw: string, rows: number = SCREEN_ROWS): string[] {
  return stripAnsi(raw)
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .filter((l) => l.trim() !== "")
    .slice(-rows);
}

/** Rows of a dialog: numbered options, a confirm or cancel hint, a question to accept. */
const DIALOG = [
  /[❯>]\s*\d+\.\s+\S/,
  /^\s*[│|]?\s*\d+\.\s+(?:Yes|No|Allow|Deny)\b/i,
  /\bDo you want to\b/i,
  /\bWould you like to\b/i,
  /\besc to cancel\b/i,
  /\benter to (?:confirm|select|continue)\b/i,
  /\bpress enter\b/i,
];

/** The input prompt: an optional box border, then `>` or `❯` and the (possibly empty) text. */
const PROMPT = /^\s*[│|]?\s*[>❯](?:\s+\S.*|\s*)(?:[│|])?\s*$/;

/** Idle: an input prompt among the rows and no dialog chrome in any of them. Fails closed. */
export function isIdlePrompt(rows: readonly string[]): boolean {
  if (rows.length === 0) return false;
  if (rows.some((r) => DIALOG.some((d) => d.test(r)))) return false;
  return rows.some((r) => PROMPT.test(r) && !/^\s*[│|]?\s*[>❯]\s*\d+\./.test(r));
}

/** Wait between a paste and the Enter that submits it, so the TUI has taken the paste in (probe, 2026-09-27). */
export const PASTE_ENTER_DELAY_MS = 100;

export type PasteOutcome =
  /** Pasted and submitted. */
  | "submitted"
  /** The screen showed no idle prompt before the paste: nothing was written. */
  | "not-idle"
  /** The screen showed a dialog, or no prompt, after the paste: the text is left in the input, and no Enter was pressed. */
  | "left-in-input";

/**
 * Paste `text` into a task's pty and press Enter once the TUI has taken it in,
 * only while `idle()` (the screen's idle prompt) holds before the paste and
 * again before the Enter. This Enter is the one deliberate unattended one
 * (nobody is at a scheduled task to press it); everywhere else the person does.
 * The text goes through the shared sanitiser (common/terminal-paste.ts).
 */
export async function pasteInto(
  write: (data: string) => void,
  text: string,
  sleep: (ms: number) => Promise<void>,
  idle: () => boolean,
): Promise<PasteOutcome> {
  if (!idle()) return "not-idle";
  write(bracketedPaste(text));
  await sleep(PASTE_ENTER_DELAY_MS);
  if (!idle()) return "left-in-input";
  write("\r");
  return "submitted";
}
