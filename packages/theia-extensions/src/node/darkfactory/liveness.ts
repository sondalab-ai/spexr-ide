import type { AgentState } from "../../common/darkfactory-protocol.js";

/**
 * Classify a session. `openPaths` is the set of transcript paths currently held
 * open by a `claude` process, or `null` when liveness could not be determined
 * (e.g. `lsof` unavailable) — in which case a session is never reported live.
 */
export function classifyState(
  transcriptPath: string,
  mtimeMs: number,
  openPaths: Set<string> | null,
  nowMs: number,
  idleWindowMs: number,
): AgentState {
  if (openPaths?.has(transcriptPath)) return "live";
  if (nowMs - mtimeMs <= idleWindowMs) return "idle";
  return "archived";
}
