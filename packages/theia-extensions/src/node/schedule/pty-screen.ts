import { Terminal } from "@xterm/headless";
import { bracketedPaste } from "../../common/terminal-paste.js";

/**
 * What a scheduled task's pty shows, so the runner's unattended Enter is
 * pressed only on Claude Code's idle input prompt. Tasks are interactive
 * `claude` sessions in a backend pty, and an Enter that lands on a dialog
 * accepts it (a permission, a question, an MCP form), so the gate fails closed.
 *
 * The pty's output is fed to a headless terminal emulator (@xterm/headless)
 * kept at the pty's size, so the rows read are the real screen: cursor
 * addressing, colour, erase and save/restore have already been applied. The
 * screen counts as idle only if all of this holds on its bottom rows:
 * - a rule row of `─`, then a `❯` input row (continuation rows allowed), then
 *   a second rule row (the CLI's input box, 2.1.296);
 * - below the second rule at most 8 non-blank rows, none of them a `❯` row or
 *   a `───` run (the footer is not matched by content: a user's status line
 *   can put anything there);
 * - the emulator's cursor is on a row of the input;
 * - no known dialog phrase (numbered options, "Enter to submit", "Esc to
 *   cancel", "to select", ...) in the footer or the 6 rows above the input box.
 * Anything else, including a layout this does not know, is not idle. The gate
 * reads the screen as it is once all output received so far is applied; a
 * dialog that opens after that read can only be caught by the next one, which
 * is why the runner reads before the paste and again before the Enter. It does
 * not tell an idle input from a busy turn with the input box still showing, nor
 * a slash-command suggestion list shown over it: Enter there queues the
 * message, or runs the command, and accepts no dialog.
 */

/** Rows of the idle layout's rule: only `─`, at least this many. */
const MIN_RULE = 8;
/** How many rows below the input's closing rule are taken as footer. */
const MAX_FOOTER_ROWS = 8;
/** How many rows an input (with pasted or typed lines) may span between its rules. */
const MAX_INPUT_ROWS = 12;
/** How many rows above the input's opening rule are searched for dialog chrome. */
const CHROME_ROWS_ABOVE = 6;

const RULE = new RegExp(`^─{${MIN_RULE},}$`);
const PROMPT = /^❯(?:\s.*)?$/;

/** Chrome of a dialog, a form or a list: numbered options, a confirm or cancel hint, a question to accept. */
const CHROME = [
  /[❯>]\s*\d+\.\s+\S/,
  /^\s*[│|]?\s*\d+\.\s+(?:Yes|No|Allow|Deny)\b/i,
  /\bDo you want to\b/i,
  /\bWould you like to\b/i,
  /\besc to cancel\b/i,
  /\benter to (?:confirm|select|continue|submit)\b/i,
  /\bpress enter\b/i,
  /\bto select\b/i,
  /\bto navigate\b/i,
  /\btype something\b/i,
];

/** The emulator's viewport as plain text, one entry per row, and the cursor's row in it. */
export interface ScreenSnapshot {
  readonly rows: readonly string[];
  readonly cursorRow: number;
}

/**
 * Idle: the bottom rows are rule, `❯` input, rule, then footer rows only; the
 * cursor is inside the input; and no dialog chrome sits in the footer or in
 * the few rows above the input. Fails closed.
 */
export function isIdleScreen(screen: ScreenSnapshot): boolean {
  const rows = screen.rows.map((r) => r.replace(/\s+$/, ""));
  let last = rows.length - 1;
  while (last >= 0 && rows[last] === "") last--;
  if (last < 0) return false;

  let closing = -1;
  for (let i = last; i >= 0 && i >= last - MAX_FOOTER_ROWS; i--) {
    if (RULE.test(rows[i]!)) {
      closing = i;
      break;
    }
  }
  if (closing < 0) return false;
  if (rows.slice(closing + 1, last + 1).some((r) => PROMPT.test(r) || /─{3,}/.test(r))) return false;

  let opening = -1;
  for (let i = closing - 1; i >= 0 && i >= closing - 1 - MAX_INPUT_ROWS; i--) {
    if (RULE.test(rows[i]!)) {
      opening = i;
      break;
    }
  }
  if (opening < 0 || opening + 1 >= closing) return false;
  const input = opening + 1;
  if (!PROMPT.test(rows[input]!) || /^❯\s*\d+\./.test(rows[input]!)) return false;
  if (rows.slice(input + 1, closing).some((r) => PROMPT.test(r))) return false;
  if (screen.cursorRow < input || screen.cursorRow >= closing) return false;

  const outside = [...rows.slice(Math.max(0, opening - CHROME_ROWS_ABOVE), opening), ...rows.slice(closing + 1, last + 1)];
  return !outside.some((r) => CHROME.some((c) => c.test(r)));
}

/**
 * A pty's screen, kept by a headless terminal fed with the pty's raw output and
 * resized with the pty. `write` is asynchronous inside the emulator, so every
 * read first waits for the output written so far to be applied.
 */
export class PtyScreen {
  private readonly term: Terminal;
  private broken = false;
  private disposed = false;

  constructor(cols: number, rows: number) {
    this.term = new Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  }

  /** The emulator's current size. */
  get size(): { cols: number; rows: number } {
    return { cols: this.term.cols, rows: this.term.rows };
  }

  /** Feed the pty's output. An emulator that cannot keep up (its write buffer overflowed) stops being trusted. */
  write(data: string): void {
    if (this.disposed) return;
    try {
      this.term.write(data);
    } catch {
      this.broken = true;
    }
  }

  /** Follow the pty's size; sizes that are not whole and positive are ignored, as the pty ignores them. */
  resize(cols: number, rows: number): void {
    if (this.disposed || !Number.isFinite(cols) || !Number.isFinite(rows)) return;
    this.term.resize(Math.max(1, Math.floor(cols)), Math.max(1, Math.floor(rows)));
  }

  /** The viewport once everything written so far is applied; undefined when disposed or no longer trusted. */
  async snapshot(): Promise<ScreenSnapshot | undefined> {
    if (this.disposed || this.broken) return undefined;
    await new Promise<void>((resolve) => this.term.write("", resolve));
    if (this.disposed || this.broken) return undefined;
    const buffer = this.term.buffer.active;
    const rows: string[] = [];
    for (let y = 0; y < this.term.rows; y++) rows.push(buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? "");
    return { rows, cursorRow: buffer.cursorY };
  }

  /** The screen shows Claude Code's idle input prompt (isIdleScreen); false when it cannot tell. */
  async isIdle(): Promise<boolean> {
    const screen = await this.snapshot();
    return screen !== undefined && isIdleScreen(screen);
  }

  /** Release the emulator. Later writes are dropped and every read says "cannot tell". */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.term.dispose();
  }
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
  idle: () => Promise<boolean>,
): Promise<PasteOutcome> {
  if (!(await idle())) return "not-idle";
  write(bracketedPaste(text));
  await sleep(PASTE_ENTER_DELAY_MS);
  if (!(await idle())) return "left-in-input";
  write("\r");
  return "submitted";
}
