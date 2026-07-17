export const DARKFACTORY_SERVICE_PATH = "/services/spexr-darkfactory";

export type AgentState = "working" | "idle" | "done";

/** How the focus pane should present a session. */
export type FocusKind = "resume-terminal" | "readonly-follow";

/** One agent session as shown on a wall tile. */
export interface AgentTile {
  sessionId: string;
  transcriptPath: string;
  projectPath: string;
  projectName: string;
  state: AgentState;
  /** True when the agent appears to be waiting for user input. */
  needsYou: boolean;
  /** False when `needsYou` is a best-effort guess (external agent). */
  needsYouCertain: boolean;
  /** One-line distilled current action. */
  actionLine: string;
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
  /** Decide whether a session opens as an interactive resume terminal or a read-only follow. */
  planFocus(sessionId: string): Promise<FocusPlan>;
  /** Begin streaming transcript turns for a read-only follow; idempotent per session. */
  startFollow(sessionId: string): Promise<void>;
  stopFollow(sessionId: string): Promise<void>;
}

/** Push channel: backend → frontend. */
export interface SpexrDarkfactoryClient {
  onTilesChanged(tiles: AgentTile[]): void;
  onFollowChunk(sessionId: string, turns: string): void;
}
