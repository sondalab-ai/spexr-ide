/**
 * What Send does, free of Theia: one bracketed paste into the agent's TUI and
 * nothing more. There is deliberately no port for Enter or for any other key:
 * submitting is the person's own press in the terminal, which is brought
 * forward and focused so they can. A paste can neither accept a dialog nor
 * change a mode, so it needs no look at what the agent is doing.
 */

/** The agent terminal, as Send drives it. */
export interface SendPorts {
  /** Theia's workspace trust: false in Restricted Mode. */
  trusted(): Promise<boolean>;
  /** A Claude session runs in the agent terminal. */
  running(): boolean;
  /** Start the agent (and only that). */
  start(): Promise<void>;
  /** Resolves when the started terminal's process is up. */
  ready(): Promise<void>;
  /** Paste `text` into the TUI's input, as one bracketed paste, with no Enter. */
  paste(text: string): void;
  /** Bring the agent's terminal forward and focus it. */
  reveal(): Promise<void>;
}

export type SendOutcome =
  /** Pasted into a terminal that was already running; the person presses Enter in the terminal. */
  | "pasted"
  /**
   * Pasted into an agent this send started: its first screen (Claude's own
   * folder-trust dialog, a login) may have taken the paste as keys or lost it,
   * so the caller keeps the text where the person can paste it again.
   */
  | "pasted-after-start"
  /** The workspace is not trusted: nothing launched, nothing pasted. */
  | "untrusted"
  /** The agent could not be started (the launch says why): nothing pasted. */
  | "not-started";

/**
 * Paste `prompt` into the agent, starting it first when none runs (in a
 * trusted workspace only), then bring its terminal forward. No Enter, ever:
 * not after the paste, and not on Claude's own folder-trust dialog a fresh
 * launch may open.
 */
export async function sendByPaste(prompt: string, ports: SendPorts): Promise<SendOutcome> {
  if (!(await ports.trusted())) return "untrusted";
  const fresh = !ports.running();
  if (fresh) {
    await ports.start();
    if (!ports.running()) return "not-started";
    await ports.ready();
  }
  ports.paste(prompt);
  await ports.reveal();
  return fresh ? "pasted-after-start" : "pasted";
}

/**
 * What Plan does: bring the agent's terminal forward, where Shift+Tab is the
 * person's own key. Nothing is typed.
 */
export async function planByReveal(ports: Pick<SendPorts, "trusted" | "running" | "reveal">): Promise<"revealed" | "untrusted" | "not-running"> {
  if (!(await ports.trusted())) return "untrusted";
  if (!ports.running()) return "not-running";
  await ports.reveal();
  return "revealed";
}
