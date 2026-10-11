import type { AgentState, FollowEvent } from "./darkfactory-protocol.js";

export const AGENT_PANE_SERVICE_PATH = "/services/spexr-agent-pane";

/** A tool call as the pane lists it: done (a result came back), run (none yet) or error. */
export type PaneToolState = "done" | "run" | "error";

/** Where the plan came from, in the order the builder tries them. */
export type PanePlanSource = "todo" | "task" | "exit-plan" | "spec";

/**
 * Claude Code's JSONL is undocumented and changes between releases, so every
 * field here but the ids is optional: a reader shows what it finds and leaves
 * the rest out, and a missing field is never an error.
 */
export interface PaneTool {
  /** The `tool_use.id` the result is paired by. */
  id: string;
  /** The tool's own name (`Edit`, `Bash`). */
  name?: string;
  /** What the pane says: `Read`, `Edit`, `Run`. */
  verb?: string;
  /** The file, command or pattern the verb acts on; a file by its name. */
  target?: string;
  /** The file's path, relative to the workspace when it lies inside it: the full name behind `target`. */
  path?: string;
  state: PaneToolState;
  /**
   * Result time minus call time. A tool that waited on a permission prompt
   * counts the wait too: the transcript has no separate stamp for it.
   */
  durationMs?: number;
  /** Lines an Edit or Write added and removed, from its `structuredPatch`. */
  added?: number;
  removed?: number;
}

/** The latest Edit or Write of the turn. */
export interface PaneDiff {
  file?: string;
  added?: number;
  removed?: number;
  /** Changed lines only, each with its `+` or `-`, capped at {@link PANE_DIFF_LINES}. */
  lines?: string[];
}

export interface PanePlanItem {
  text: string;
  done: boolean;
}

/** The turn in progress or last finished: from the latest genuine prompt on. */
export interface AgentPaneTurn {
  prompt?: string;
  /** The agent's prose blocks of the turn, oldest first, the last few only. */
  prose?: string[];
  /** Every tool call of the turn but the plan tools (TodoWrite, Task*, ExitPlanMode), in call order. */
  tools?: PaneTool[];
  diff?: PaneDiff;
}

/**
 * Where the followed session's turn stands, read from its transcript:
 * - `ready`: the last message ended the turn and no tool call is open. Claude
 *   is at its prompt (a label only: no write into the agent is gated on it,
 *   because the transcript does not show every dialog).
 * - `working`: a turn is open (a prompt or a result to act on, a call running).
 * - `permission`: a call that asks for permission is unresolved: Claude may be
 *   showing a dialog, where Enter would accept it.
 */
export type PanePhase = "ready" | "working" | "permission";

export interface AgentPaneSnapshot {
  sessionId: string;
  title?: string;
  model?: string;
  state?: AgentState;
  needsYou?: boolean;
  phase?: PanePhase;
  /** The last `permission-mode` record. */
  permissionMode?: string;
  /** `permissionMode` is `plan` as the file last recorded it: it can lag the TUI, so nothing is gated on it (the composer reads the terminal's footer). */
  planMode?: boolean;
  turn?: AgentPaneTurn;
  plan?: PanePlanItem[];
  planSource?: PanePlanSource;
  /** Output tokens of the latest response over the time it took, rounded. */
  tokPerSec?: number;
  /** Every tool call in the transcript, plan tools included. */
  toolCount?: number;
  /** The transcript's last entry time, epoch ms. */
  updatedAtMs?: number;
}

/**
 * What changed since the snapshot the client holds, when the turn is the same
 * one: tools are by id, new ones appended and known ones replaced; the rest
 * replace the field whole.
 */
export interface AgentPaneDelta {
  sessionId: string;
  tools?: PaneTool[];
  prose?: string[];
  diff?: PaneDiff;
  plan?: PanePlanItem[];
  planSource?: PanePlanSource;
  title?: string;
  model?: string;
  state?: AgentState;
  needsYou?: boolean;
  phase?: PanePhase;
  permissionMode?: string;
  planMode?: boolean;
  tokPerSec?: number;
  toolCount?: number;
  updatedAtMs?: number;
}

/** The changed lines of a diff card. */
export const PANE_DIFF_LINES = 6;
/** The events the Agent log shows. */
export const PANE_LOG_EVENTS = 400;
/** The prose blocks of a turn kept in a snapshot. */
export const PANE_PROSE_BLOCKS = 6;

/** What the pane is bound to: the session the agent terminal started, in a workspace. */
export interface AgentPaneBinding {
  sessionId: string;
  /** The workspace folder's path; the transcript's directory and `docs/specs` come from it. */
  workspacePath: string;
  /** A name for the head (custom name, summary or goal), when the frontend has one. */
  title?: string;
  /**
   * The id comes from storage, not from a launch this window made: the session
   * may be long finished, so a newer transcript in its folder is taken as its
   * successor only while a Claude process runs there.
   */
  fromStorage?: boolean;
  /**
   * A look at a session that is not the agent terminal's own (the Sessions
   * part): its transcript is read and never left for a successor, because a
   * newer transcript in its folder is more likely the agent's own than this
   * session's continuation.
   */
  readOnly?: boolean;
}

export interface AgentPaneService {
  /**
   * Follow a session: its snapshot now, then pushes as the transcript grows.
   * Replaces any earlier follow. Undefined when no transcript exists yet; the
   * service keeps looking for it and pushes the snapshot once it appears.
   */
  follow(binding: AgentPaneBinding): Promise<AgentPaneSnapshot | undefined>;
  /** Stop following. */
  stop(): Promise<void>;
  /**
   * `sessionId`'s last {@link PANE_LOG_EVENTS} events with their times, the
   * Agent log's lines. Empty when that is not the session being followed (the
   * follow moved on while the read was on its way) or nothing is followed.
   */
  readLog(sessionId: string): Promise<FollowEvent[]>;
}

export interface AgentPaneClient {
  onSnapshot(snapshot: AgentPaneSnapshot): void;
  onDelta(delta: AgentPaneDelta): void;
  /**
   * The followed session was cleared or resumed into another transcript and
   * the pane now follows `to`. A snapshot of `to` follows.
   */
  onSessionAdopted(from: string, to: string): void;
}
