import type { AgentState } from "./darkfactory-protocol.js";

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
  /** The file, command or pattern the verb acts on. */
  target?: string;
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

export interface AgentPaneSnapshot {
  sessionId: string;
  title?: string;
  model?: string;
  state?: AgentState;
  needsYou?: boolean;
  /** The last `permission-mode` record. */
  permissionMode?: string;
  /** `permissionMode` is `plan`: the composer's Plan toggle reads this back. */
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
  permissionMode?: string;
  planMode?: boolean;
  tokPerSec?: number;
  toolCount?: number;
  updatedAtMs?: number;
}

/** The changed lines of a diff card. */
export const PANE_DIFF_LINES = 6;
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
