const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a string is a Claude session UUID (safe to pass to `claude --resume`). */
export function isSessionId(sessionId: string): boolean {
  return UUID_RE.test(sessionId);
}

/** Args for `claude` to resume a session. Rejects any sessionId that is not a UUID. */
export function buildResumeArgs(sessionId: string, fork: boolean): string[] {
  if (!isSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
  const args = ["--resume", sessionId];
  if (fork) args.push("--fork-session");
  return args;
}
