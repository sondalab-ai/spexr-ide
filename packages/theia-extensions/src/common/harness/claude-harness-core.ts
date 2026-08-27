import type { HarnessCore } from "./harness-types.js";
import { buildResumeArgs, isSessionId } from "./resume-args.js";

/**
 * Browser-safe core of the Claude harness: id, process names, and the pure
 * UUID-based resume helpers. The full adapter (with disk-walking session members)
 * lives in `claude-harness.ts`, which the frontend must not import.
 */
export const claudeCore: HarnessCore = {
  id: "claude",
  processNames: () => ["claude"],
  isResumableId: (sessionId) => isSessionId(sessionId),
  buildResumeArgs: (sessionId, fork) => buildResumeArgs(sessionId, fork),
};
