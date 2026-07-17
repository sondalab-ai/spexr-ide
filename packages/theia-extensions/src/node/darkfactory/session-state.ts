import type { AgentState } from "../../common/darkfactory-protocol.js";

const IDLE_WINDOW_MS = 12 * 3_600_000;

/**
 * Classify a session at project granularity.
 * - working: a live `claude` process runs in the project, this is the project's
 *   newest transcript, and it was written within `workingWindowMs`.
 * - idle: written within the idle window but not currently working.
 * - done: older, not working.
 * `liveDirs` is `null` when process scanning failed → never "working".
 */
export function classifySession(
  projectPath: string,
  mtimeMs: number,
  isNewestInProject: boolean,
  liveDirs: Set<string> | null,
  nowMs: number,
  workingWindowMs: number,
): AgentState {
  const age = nowMs - mtimeMs;
  const working = !!liveDirs?.has(projectPath) && isNewestInProject && age <= workingWindowMs;
  if (working) return "working";
  if (age <= IDLE_WINDOW_MS) return "idle";
  return "done";
}
