import type { HarnessId } from "./harness/harness-types.js";

export const DARKFACTORY_SERVICE_PATH = "/services/spexr-darkfactory";

export type AgentState = "working" | "idle" | "done";

/**
 * How long a session name may be. It is a card heading, not a note: past this it
 * stops fitting the head row and starts crowding out the chips beside it.
 */
export const MAX_SESSION_NAME_CHARS = 80;

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
  /** The name the user gave this session; absent until they rename it. */
  customName?: string;
}

/** Two-level AI description of a session, from the local model. */
export interface AgentSummary {
  /** Present-tense clause: what the agent is doing right now. */
  now: string;
  /** One sentence: what the whole session is trying to accomplish. */
  overview: string;
}

/** One session matching a natural-language query, ready to render as a tile. */
export interface SessionHit {
  tile: AgentTile;
  /** Hybrid score, dense and lexical blended; higher is a better match. */
  score: number;
  /**
   * The weighted halves `score` is made of, so the UI can show which pass found
   * the session: `dense` is meaning, `lexical` is the literal words. They sum to
   * `score`.
   *
   * Comparable within one result set only. The lexical half is normalised
   * against the best lexical hit for the query that produced it, so the same
   * session scores differently under a different query.
   */
  dense: number;
  lexical: number;
  /** Query terms that moved the lexical half, strongest contribution first. */
  terms: string[];
  /** True when the session was outside the wall's current scan window. */
  archived: boolean;
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

/** One Claude config directory a new session can be started under. */
export interface ClaudeConfigDir {
  /** Absolute path, exported as CLAUDE_CONFIG_DIR when the session starts. */
  path: string;
  /** Directory name, e.g. `.claude-perso` — how the account is named in the UI. */
  label: string;
  /** True for the dir a bare `claude` would use here; the launcher pre-selects it. */
  isDefault: boolean;
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
  /** Claude config dirs a new session can be started under; one entry per discovered account. */
  listConfigDirs(): Promise<ClaudeConfigDir[]>;
  /** Two-level AI description (now + overview) from the local model; cached, empty fields if unavailable. */
  summarize(sessionId: string): Promise<AgentSummary>;
  /** Rank indexed sessions against a natural-language query; `[]` for an empty query. */
  searchSessions(query: string): Promise<SessionHit[]>;
  /**
   * Name a session, or clear its name with an empty string. The name is stored
   * per session id and survives restarts; the wall is pushed the updated tiles
   * so the card renames without waiting for the next scan.
   */
  renameSession(sessionId: string, name: string): Promise<void>;
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
  /** Session-index crawl progress; `done === total` means the crawl finished. */
  onSessionIndexProgress(done: number, total: number): void;
}
