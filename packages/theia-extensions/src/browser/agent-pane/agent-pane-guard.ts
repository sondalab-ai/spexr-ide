import type { AgentPaneCheckpoint } from "../../common/agent-pane-protocol.js";

/**
 * What the composer may do to the agent's TUI, and under what conditions.
 * Typing into Claude Code is a keyboard: an Enter that lands on a permission
 * dialog accepts it, and Shift+Tab can leave the session in a mode that stops
 * asking. So nothing is typed unless the transcript says Claude is at its
 * prompt, and that is read again right before each keystroke that matters.
 */

/** The agent terminal, as the guards drive it. */
export interface GuardPorts {
  /** Theia's workspace trust: false in Restricted Mode. */
  trusted(): Promise<boolean>;
  /** A Claude session runs in the agent terminal. */
  running(): boolean;
  /** Start the agent (and only that: nothing is typed into it). */
  start(): Promise<void>;
  /** The followed session's phase and mode, read from the transcript now. */
  checkpoint(): Promise<AgentPaneCheckpoint | undefined>;
  /** Put text into the TUI's input without submitting it (a paste: the terminal brackets it when the TUI asked). */
  paste(text: string): void;
  /** Enter. */
  submit(): void;
  /** One Shift+Tab. */
  cycleMode(): void;
  sleep(ms: number): Promise<void>;
}

export type SendOutcome =
  /** Typed and submitted. */
  | "sent"
  /** The workspace is not trusted: nothing launched, nothing typed. */
  | "untrusted"
  /** No agent was running: it was started, and nothing was typed (a first launch can open Claude's own dialogs). */
  | "started"
  /** The session is not at its prompt (working, or a permission may be pending): nothing typed. */
  | "busy"
  /** The session left its prompt after the text was typed: the text stays in the TUI's input, unsubmitted. */
  | "raced";

const ready = (c: AgentPaneCheckpoint | undefined): boolean => c?.phase === "ready";

/**
 * Send a message, only to an idle Claude.
 *
 * 1. Not in an untrusted workspace, and with no agent running only start one.
 * 2. Read the transcript: the turn must have ended and no call be open (an
 *    idle Claude cannot raise a permission dialog by itself).
 * 3. Paste the text, without Enter.
 * 4. Read again. Only if it is still idle, press Enter. Otherwise the text is
 *    left where the user can see it in the TUI, and nothing is submitted.
 */
export async function guardedSend(prompt: string, ports: GuardPorts): Promise<SendOutcome> {
  if (!(await ports.trusted())) return "untrusted";
  if (!ports.running()) {
    await ports.start();
    return "started";
  }
  if (!ready(await ports.checkpoint())) return "busy";
  ports.paste(prompt);
  if (!ready(await ports.checkpoint())) return "raced";
  ports.submit();
  return "sent";
}

/** The permission modes Shift+Tab walks through that ask before acting: the only two a session may be left in. */
const SAFE_MODES = new Set(["default", "plan"]);

export type PlanOutcome =
  | { readonly ok: true; readonly mode: string }
  | {
      readonly ok: false;
      readonly reason: "untrusted" | "not-running" | "busy" | "unconfirmed" | "no-way";
      /** The mode the session was last seen in. */
      readonly mode?: string;
      /** The session was left in a mode that does not ask (acceptEdits, auto, bypass): the user must be told. */
      readonly unsafe?: boolean;
    };

/** Presses before giving up: the cycle is three or four stops long. */
const MAX_PRESSES = 6;
/** How long a press is waited on to show in the transcript. */
const CONFIRM_MS = 3000;
const POLL_MS = 150;

/**
 * Move the session into plan mode, or out of it, one Shift+Tab at a time.
 *
 * Only from an idle session, and again before each press. After each press
 * the mode is read back from the transcript, and the press repeated until the
 * mode is the one wanted: `plan` to enter, `default` to leave. The cycle may
 * pass through other modes on the way (accept-edits, auto), which cost
 * nothing while idle, but the session is never left in one: if the way to the
 * wanted mode cannot be confirmed, the outcome says so and whether it was
 * left in a mode that does not ask.
 */
export async function guardedPlanToggle(ports: GuardPorts): Promise<PlanOutcome> {
  if (!(await ports.trusted())) return { ok: false, reason: "untrusted" };
  if (!ports.running()) return { ok: false, reason: "not-running" };
  let seen = await ports.checkpoint();
  if (!ready(seen)) return { ok: false, reason: "busy", ...(seen?.permissionMode ? { mode: seen.permissionMode } : {}) };
  let mode = seen?.permissionMode ?? "default";
  const target = mode === "plan" ? "default" : "plan";
  for (let press = 0; press < MAX_PRESSES; press++) {
    ports.cycleMode();
    const before = mode;
    const waitedFrom = Date.now();
    let changed = false;
    do {
      await ports.sleep(POLL_MS);
      seen = await ports.checkpoint();
      if (seen?.permissionMode !== undefined && seen.permissionMode !== before) {
        mode = seen.permissionMode;
        changed = true;
      }
    } while (!changed && Date.now() - waitedFrom < CONFIRM_MS);
    if (!changed) return { ok: false, reason: "unconfirmed", mode, unsafe: !SAFE_MODES.has(mode) };
    if (mode === target) return { ok: true, mode };
    // Another stop on the way: only on an idle session may the next press be made.
    if (!ready(seen)) return { ok: false, reason: "busy", mode, unsafe: !SAFE_MODES.has(mode) };
  }
  return { ok: false, reason: "no-way", mode, unsafe: !SAFE_MODES.has(mode) };
}
