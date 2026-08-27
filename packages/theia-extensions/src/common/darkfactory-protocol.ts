import type { HarnessId } from "./harness/harness-types.js";

export const DARKFACTORY_SERVICE_PATH = "/services/spexr-darkfactory";

export type AgentState = "working" | "idle" | "done";

/** How the focus pane should present a session. */
export type FocusKind = "resume-terminal" | "readonly-follow";

/** One agent session as shown on a wall tile. */
export interface AgentTile {
  sessionId: string;
  /** Which agent CLI this session belongs to (drives the tile's harness chip). */
  harness: HarnessId;
  transcriptPath: string;
  projectPath: string;
  projectName: string;
  state: AgentState;
  /** True when the agent appears to be waiting for user input. */
  needsYou: boolean;
  /** False when `needsYou` is a best-effort guess (external agent). */
  needsYouCertain: boolean;
  /** True when the most recent tool result was an error. */
  lastFailed: boolean;
  /** What the agent is working on — the latest user instruction. */
  goal: string;
  /** One-line distilled current action. */
  actionLine: string;
  /** Recent tool calls, chronological, as short chips. */
  recentActions: string[];
  tool?: string;
  target?: string;
  gitBranch?: string;
  mode?: string;
  permissionMode?: string;
  lastActivityMs: number;
  turnCount: number;
  /** Stable index into the frontend accent palette, derived from `projectPath`. */
  accentId: number;
}

/** Two-level AI description of a session, from the local model. */
export interface AgentSummary {
  /** Present-tense clause: what the agent is doing right now. */
  now: string;
  /** One sentence: what the whole session is trying to accomplish. */
  overview: string;
}

/** One rendered line of a read-only follow, tagged so the UI can style it like a terminal. */
export interface FollowEvent {
  /**
   * prompt = a genuine user instruction; assistant = the agent's prose;
   * tool = a tool call (a shell command or file/search op); result = a tool's
   * output; error = a failed tool result.
   */
  kind: "prompt" | "assistant" | "tool" | "result" | "error";
  text: string;
}

/** How the frontend should open a session in the focus pane. */
export interface FocusPlan {
  sessionId: string;
  projectPath: string;
  /** Config dir that owns the session; passed as CLAUDE_CONFIG_DIR when resuming. */
  configDir: string;
  kind: FocusKind;
}

/** Backend service consumed by the Darkfactory wall. */
export interface SpexrDarkfactoryService {
  listTiles(): Promise<AgentTile[]>;
  /** Two-level AI description (now + overview) from the local model; cached, empty fields if unavailable. */
  summarize(sessionId: string): Promise<AgentSummary>;
  /** Decide whether a session opens as an interactive resume terminal or a read-only follow. */
  planFocus(sessionId: string): Promise<FocusPlan>;
  /** Begin streaming transcript turns for a read-only follow; idempotent per session. */
  startFollow(sessionId: string): Promise<void>;
  stopFollow(sessionId: string): Promise<void>;
}

/** Push channel: backend → frontend. */
export interface SpexrDarkfactoryClient {
  onTilesChanged(tiles: AgentTile[]): void;
  /** Incremental read-only follow output, as typed events (newest transcript entries). */
  onFollowChunk(sessionId: string, events: FollowEvent[]): void;
}
