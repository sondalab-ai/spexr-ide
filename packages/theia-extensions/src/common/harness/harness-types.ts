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
 * The launch-free, process-agnostic core of a harness (id, process names, and
 * the pure resume-arg helpers). Contains no Node imports, so the browser bundle
 * can import a harness's core to route resume terminals by session-id shape
 * without pulling `child_process`/`fs` into the frontend.
 */
export interface HarnessCore {
  /** Stable identifier of this harness. */
  readonly id: HarnessId;
  /** Process command names (`ps -Ao pid,comm`) that indicate a live session. */
  processNames(): string[];
  /** Whether a string is a resumable session id for this harness. */
  isResumableId(sessionId: string): boolean;
  /** CLI args to resume the given (already-validated) session id. */
  buildResumeArgs(sessionId: string, fork: boolean): string[];
}

/**
 * A harness core plus its Darkfactory session members (Node-only: they spawn the
 * CLI / read transcripts). Backend code consumes the full adapter; browser code
 * must import only `HarnessCore` (see the two `*-harness-core.ts` modules).
 */
export interface HarnessAdapter extends HarnessCore {
  /** Enumerate this harness's sessions globally; `[]` when enumeration is unavailable. */
  listSessions(): Promise<HarnessSessionRef[]>;
  /** Distill one session's transcript into display fields; never throws. */
  parseTranscript(ref: HarnessSessionRef): Promise<ParsedTranscript>;
  /** Begin a read-only incremental tail of a session (opencode: Slice 5). */
  followSession(id: string): FollowHandle;
}
