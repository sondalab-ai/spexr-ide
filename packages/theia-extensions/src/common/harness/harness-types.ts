/**
 * One session discovered by a harness's enumeration. `sessionId` and
 * `projectPath` are the tile group key; `mtimeMs` drives recency ordering and
 * liveness; `loadEntries` lazily produces the transcript entries in Claude's
 * entry shape (`{isMeta?, message:{role,content}}`) so the shared tile pipeline
 * consumes every harness identically.
 */
export interface HarnessSessionRef {
  sessionId: string;
  projectPath: string;
  mtimeMs: number;
  loadEntries(): Promise<unknown[]>;
}

/** Incremental transcript tail for a read-only follow (Slice 5 for opencode). */
export interface FollowHandle {
  start(onChunk: (entries: unknown[]) => void): Promise<void>;
  stop(): void;
}

/** The set of agent CLIs SPEXR can drive. */
export type HarnessId = "claude" | "opencode";

/** Fields distilled from one session transcript, harness-independent. */
export interface ParsedTranscript {
  cwd?: string;
  gitBranch?: string;
  mode?: string;
  permissionMode?: string;
  userTurns: number;
  /** First genuine human instruction — the session's goal (injected/meta skipped). */
  goal: string;
  lastPrompt: string;
  lastTool?: string;
  /**
   * True for interactive TUI sessions. Claude uses this to filter SDK / one-shot
   * subagent sessions out of the wall; opencode reports all its TUI sessions as
   * interactive (it has no headless flood today).
   */
  interactive: boolean;
}

/**
 * Abstraction over an agent harness (Claude Code, opencode). Captures the points
 * where SPEXR previously assumed the `claude` CLI. Slice 1 defines the launch-
 * free core; Slices 2–4 add the Darkfactory session members below.
 */
export interface HarnessAdapter {
  /** Stable identifier of this harness. */
  readonly id: HarnessId;
  /** Process command names (`ps -Ao pid,comm`) that indicate a live session. */
  processNames(): string[];
  /** Whether a string is a resumable session id for this harness. */
  isResumableId(sessionId: string): boolean;
  /** CLI args to resume the given (already-validated) session id. */
  buildResumeArgs(sessionId: string, fork: boolean): string[];
  /** Enumerate this harness's sessions globally; `[]` when enumeration is unavailable. */
  listSessions(): Promise<HarnessSessionRef[]>;
  /** Distill one session's transcript into display fields; never throws. */
  parseTranscript(ref: HarnessSessionRef): Promise<ParsedTranscript>;
  /** Begin a read-only incremental tail of a session (opencode: Slice 5). */
  followSession(id: string): FollowHandle;
}
