import type { HarnessCore } from "./harness-types.js";

/** Opaque `ses_…` ids; the regex doubles as the shell-arg sanitizer. */
export const RESUMABLE_ID = /^ses_[A-Za-z0-9]+$/;

/**
 * Browser-safe core of the opencode harness: id, process name, and the pure
 * `--session`/`--fork` resume helpers (opencode flags are not symmetric with
 * Claude's — no `--fork-session`). The full adapter (with `opencode db`
 * enumeration and `opencode export` parsing) lives in `opencode-harness.ts`,
 * which the frontend must not import.
 */
export const opencodeCore: HarnessCore = {
  id: "opencode",
  processNames: () => ["opencode"],
  isResumableId: (sessionId) => RESUMABLE_ID.test(sessionId),
  buildResumeArgs: (sessionId, fork) => (fork ? ["--session", sessionId, "--fork"] : ["--session", sessionId]),
};
