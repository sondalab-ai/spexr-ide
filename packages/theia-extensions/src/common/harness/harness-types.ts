/** The set of agent CLIs SPEXR can drive. */
export type HarnessId = "claude" | "opencode";

/**
 * Abstraction over an agent harness (Claude Code, opencode). Captures the points
 * where SPEXR previously assumed the `claude` CLI. Slice 1 defines only the
 * members needed to route today's Claude logic; launch, session-history, and
 * memory members are added by later slices.
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
}
