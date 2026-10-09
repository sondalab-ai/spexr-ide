/**
 * The composer's logic, free of Theia and React: what is typed into the agent
 * terminal for a message and for the Plan toggle, and when each control is
 * usable. The composer types into Claude Code's TUI, so what it sends is what
 * a keyboard would.
 */

/** Shift+Tab: Claude Code's key for cycling its permission mode. */
export const SHIFT_TAB = "\x1b[Z";

/** The modes Shift+Tab walks through, in order; `plan` is the one the Plan button wants. */
const MODE_CYCLE = ["default", "acceptEdits", "plan"] as const;

/**
 * A message as the terminal may receive it: line endings normalised, and every
 * control character but the newline and the tab dropped. An escape in it
 * would be read by the TUI as a key (or, in a bracketed paste, as the
 * paste's own end), so what the user typed can never be taken for one.
 */
export function sanitizeMessage(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

/**
 * The prompt to send: the typed text, trimmed, led by `@<relative path> ` when
 * the file chip is pressed. Undefined when there is nothing to send (a chip
 * alone is not a message).
 */
export function assemblePrompt(draft: string, chipPath: string | undefined): string | undefined {
  const text = sanitizeMessage(draft).trim();
  if (!text) return undefined;
  const path = chipPath ? sanitizeMessage(chipPath).replace(/\s+/g, " ").trim() : "";
  return path ? `@${path} ${text}` : text;
}

/** A message with a line break in it: typed as one line it would be submitted at the first. */
export function isMultiline(prompt: string): boolean {
  return prompt.includes("\n");
}

/**
 * How many Shift+Tab presses the Plan button sends. From plan, one leaves it;
 * from the default mode two reach it, from accept-edits one. A mode outside
 * that cycle (auto, bypass) sits somewhere the cycle does not tell: one press,
 * and the transcript's `permission-mode` says where it landed.
 */
export function planPresses(permissionMode: string | undefined): number {
  if (permissionMode === "plan") return 1;
  const at = MODE_CYCLE.indexOf((permissionMode ?? "default") as (typeof MODE_CYCLE)[number]);
  return at < 0 ? 1 : MODE_CYCLE.indexOf("plan") - at;
}

/** Why Send is off, when the reason is the user's to know. */
export type DisabledReason = "needs-you";

export interface ComposerInputs {
  readonly draft: string;
  /** The agent terminal has a running Claude. */
  readonly running: boolean;
  /** The agent waits for the user in the terminal (a permission prompt, or its turn ended). */
  readonly needsYou: boolean;
  /** The pane follows the agent terminal's own session; false for any other (S6j's read-only follows). */
  readonly ownSession: boolean;
  /** A send is in flight. */
  readonly sending: boolean;
}

export interface ComposerState {
  /** `open`: the pane shows another session; the composer offers to open it in a terminal. */
  readonly mode: "send" | "open";
  readonly canSend: boolean;
  readonly canPlan: boolean;
  readonly reason?: DisabledReason;
}

/**
 * What the composer lets the user do. Send needs words and a free agent; with
 * no agent running it is allowed, and starts one first. Plan is a key into the
 * running TUI, so it needs a running agent that is not waiting on a prompt:
 * Shift+Tab at a permission prompt is a different key there.
 */
export function composerState(i: ComposerInputs): ComposerState {
  if (!i.ownSession) return { mode: "open", canSend: false, canPlan: false };
  const hasWords = sanitizeMessage(i.draft).trim().length > 0;
  const free = !i.needsYou && !i.sending;
  return {
    mode: "send",
    canSend: hasWords && free,
    canPlan: i.running && free,
    ...(i.needsYou ? { reason: "needs-you" as const } : {}),
  };
}
