import type { HarnessAdapter } from "./harness-types.js";
import { buildResumeArgs, isSessionId } from "./resume-args.js";

/**
 * The Claude Code harness. Delegates to the existing Claude helpers so behavior
 * is identical to the pre-abstraction code; this object is the routing point
 * that later slices sit a second harness beside.
 */
export const claudeHarness: HarnessAdapter = {
  id: "claude",
  processNames: () => ["claude"],
  isResumableId: (sessionId) => isSessionId(sessionId),
  buildResumeArgs: (sessionId, fork) => buildResumeArgs(sessionId, fork),
};
