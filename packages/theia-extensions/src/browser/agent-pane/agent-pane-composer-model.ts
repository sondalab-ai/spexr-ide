/**
 * The composer's logic, free of Theia and React: what is typed into the agent
 * terminal for a message and for the Plan toggle, and when each control is
 * usable. The composer types into Claude Code's TUI, so what it sends is what
 * a keyboard would.
 */

/** Shift+Tab: Claude Code's key for cycling its permission mode. */
export const SHIFT_TAB = "\x1b[Z";

/**
 * A message as the terminal may receive it: line endings normalised, and every
 * control character but the newline and the tab dropped. An escape in it
 * would be read by the TUI as a key (or, in a bracketed paste, as the
 * paste's own end), so what the user typed can never be taken for one.
 */
export function sanitizeMessage(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
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

/** Why Send is off, when the reason is the user's to know. */
export type DisabledReason = "needs-you" | "working" | "untrusted";

export interface ComposerInputs {
  readonly draft: string;
  /** The agent terminal has a running Claude. */
  readonly running: boolean;
  /** The followed session's phase from the transcript; undefined until a snapshot arrives. */
  readonly phase: "ready" | "working" | "permission" | undefined;
  /** The workspace is trusted (Theia's workspace trust). */
  readonly trusted: boolean;
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
 * What the composer lets the user do.
 * - Nothing in an untrusted workspace.
 * - With no agent running, Send is allowed with words, and only starts the agent.
 * - With one running, Send and Plan need the transcript to say Claude is at
 *   its prompt (`ready`): while it works, or a permission may be pending, both
 *   are off, and the reason is shown.
 */
export function composerState(i: ComposerInputs): ComposerState {
  if (!i.ownSession) return { mode: "open", canSend: false, canPlan: false };
  if (!i.trusted) return { mode: "send", canSend: false, canPlan: false, reason: "untrusted" };
  const hasWords = sanitizeMessage(i.draft).trim().length > 0;
  if (!i.running) return { mode: "send", canSend: hasWords && !i.sending, canPlan: false };
  if (i.phase === "permission") return { mode: "send", canSend: false, canPlan: false, reason: "needs-you" };
  if (i.phase !== "ready") return { mode: "send", canSend: false, canPlan: false, reason: "working" };
  return { mode: "send", canSend: hasWords && !i.sending, canPlan: !i.sending };
}
