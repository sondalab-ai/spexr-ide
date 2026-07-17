export const DARKFACTORY_SERVICE_PATH = "/services/spexr-darkfactory";

export type AgentState = "live" | "idle" | "archived";

/** One Claude Code session (one transcript), as shown on a Darkfactory card. */
export interface AgentSession {
  /** Transcript filename stem; stable id for summaries. */
  sessionId: string;
  /** Absolute path to the `.jsonl` transcript. */
  transcriptPath: string;
  /** Real project directory (from the transcript `cwd`). */
  projectPath: string;
  /** Basename of `projectPath`, for the card title. */
  projectName: string;
  gitBranch?: string;
  state: AgentState;
  /** Transcript modified time, epoch ms. */
  lastActivityMs: number;
  /** Number of user turns. */
  turnCount: number;
  /** Truncated last user prompt; also the heuristic summary fallback. */
  lastPrompt: string;
  lastTool?: string;
  mode?: string;
  permissionMode?: string;
}

/** A generated one-line activity summary for a session. */
export interface AgentSummary {
  sessionId: string;
  text: string;
  /** False when the model was unavailable and `text` is the heuristic fallback. */
  fromModel: boolean;
}

/** Backend service consumed by the Darkfactory widget. */
export interface SpexrDarkfactoryService {
  /** All sessions (live + idle by default; `includeArchived` adds older ones). */
  listAgents(includeArchived?: boolean): Promise<AgentSession[]>;
  /** One-line summary for a session (model, else heuristic). */
  summarize(sessionId: string): Promise<AgentSummary>;
  /** Reveal a project directory in the OS file manager. */
  revealInFileManager(projectPath: string): Promise<void>;
}

/** Push channel: backend → frontend when the session set changes. */
export interface SpexrDarkfactoryClient {
  onAgentsChanged(agents: AgentSession[]): void;
}
