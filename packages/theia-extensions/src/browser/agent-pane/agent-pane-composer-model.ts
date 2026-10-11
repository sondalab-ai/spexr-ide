import { sanitizePaste } from "../../common/terminal-paste.js";

/**
 * The composer's logic, free of Theia and React: what is pasted into the agent
 * terminal for a message, and when each control is usable. The composer never
 * presses a key in the agent's TUI: Send is one bracketed paste, and the
 * person presses Enter in the terminal themselves; Plan only brings the
 * terminal forward. (An Enter lands on whatever dialog is up, and Shift+Tab can
 * accept a permission "for this session": neither can be told apart from the
 * transcript, which does not show every dialog.)
 */

/** A message as the terminal may receive it: the shared paste sanitiser (common/terminal-paste.ts). */
export const sanitizeMessage = sanitizePaste;

/** `@path`, quoted the way Claude Code reads a path with spaces: `@"my dir/a.ts"`. */
export function fileMention(path: string): string {
  const clean = sanitizeMessage(path).replace(/[\r\n]+/g, " ").trim();
  return /\s/.test(clean) ? `@"${clean.replace(/"/g, "")}"` : `@${clean}`;
}

/**
 * The prompt to paste: the typed text, trimmed, led by the file's `@path` when
 * the chip is pressed. Undefined when there is nothing to send (a chip alone is
 * not a message).
 */
export function assemblePrompt(draft: string, chipPath: string | undefined): string | undefined {
  const text = sanitizeMessage(draft).trim();
  if (!text) return undefined;
  const mention = chipPath ? fileMention(chipPath) : "";
  return mention && mention !== "@" ? `${mention} ${text}` : text;
}

/**
 * `file` relative to the agent's own working folder: the folder Claude Code
 * resolves an `@path` from, which is not always the workspace root the file
 * lies in. Both are URI paths. Undefined when the file is outside the folder:
 * there is then no `@path` the agent could read it by.
 */
export function pathFromAgentRoot(agentRoot: string | undefined, file: string): string | undefined {
  if (!agentRoot) return undefined;
  const root = agentRoot.replace(/\/+$/, "");
  if (!file.startsWith(`${root}/`)) return undefined;
  return file.slice(root.length + 1);
}

/** The prompt starts a shell command in Claude Code (`!`): the composer says so, as nothing else shows it. */
export function startsShellCommand(prompt: string | undefined): boolean {
  return prompt?.startsWith("!") === true;
}

/** Why Send is off, when the reason is the user's to know. */
export type DisabledReason = "untrusted";

export interface ComposerInputs {
  readonly draft: string;
  /** The agent terminal has a running Claude. */
  readonly running: boolean;
  /** The workspace is trusted (Theia's workspace trust). */
  readonly trusted: boolean;
  /** The pane follows the agent terminal's own session; false for any other (the Sessions part's read-only follows). */
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
 * - Send needs words: it pastes them (starting the agent first when none runs),
 *   whatever the agent is doing, because a paste without Enter submits nothing
 *   and so grants no consent. (This is also what lets the first prompt of a
 *   session be sent, when no transcript exists to say anything.)
 * - Plan only brings the running agent's terminal forward, so it needs one.
 */
export function composerState(i: ComposerInputs): ComposerState {
  if (!i.ownSession) return { mode: "open", canSend: false, canPlan: false };
  if (!i.trusted) return { mode: "send", canSend: false, canPlan: false, reason: "untrusted" };
  const hasWords = sanitizeMessage(i.draft).trim().length > 0;
  return { mode: "send", canSend: hasWords && !i.sending, canPlan: i.running && !i.sending };
}
