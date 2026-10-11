/**
 * What may be typed into a running agent's terminal on a person's behalf.
 * The agent's TUI reads its input as keys: an Enter lands on whatever dialog
 * is up, and an escape sequence is a key press (Shift+Tab, `ESC [ Z`, moves
 * Claude Code to the next permission mode). So text that came from anywhere
 * but the keyboard (a message field, a spec, a TODO, a check's output) goes in
 * only as one bracketed paste, stripped of every control character first, and
 * is never followed by Enter: submitting is the person's own key press in the
 * terminal. The one writer of that kind that does press Enter is the schedule
 * runner: its tasks are interactive `claude` sessions in a backend pty with
 * nobody at them, so its Enter is pressed only when the pty's screen shows an
 * idle input prompt and no dialog (node/schedule/pty-screen.ts, which uses
 * this same sanitiser), and otherwise the task is marked as needing the user.
 */

/** Start and end of a bracketed paste (DEC private mode 2004). */
export const PASTE_START = "\x1b[200~";
export const PASTE_END = "\x1b[201~";

/**
 * `text` as a terminal may receive it: CR and CRLF become LF, and every other
 * control character but LF and tab is dropped (C0, DEL and C1), above all ESC
 * and the C1 CSI, so the text can neither end a paste early with `ESC[201~`
 * nor become keystrokes after it.
 */
export function sanitizePaste(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
}

/**
 * `text` as one bracketed paste with the markers written out, whatever mode
 * the terminal thinks the program is in: a TUI that did not ask for bracketing
 * would otherwise take the text as typed keys.
 */
export function bracketedPaste(text: string): string {
  return `${PASTE_START}${sanitizePaste(text)}${PASTE_END}`;
}
