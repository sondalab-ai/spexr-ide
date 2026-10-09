/**
 * The session id the agent terminal's Claude is started with (`--session-id`),
 * so the agent pane can follow that session's transcript without guessing
 * which one is the terminal's. Pure: the manager generates, persists and uses it.
 */

/** Flags that already name or choose the session: appending `--session-id` to them would be refused or wrong. */
const SESSION_FLAGS = ["--session-id", "--resume", "-r", "--continue", "-c"];

/**
 * The shell args with `--session-id <id>` appended. Appended last, which is
 * where a launch profile's wrapper command receives it too (the args follow
 * the command in the `-c` line). Left alone when the args already carry a
 * flag that decides the session.
 */
export function withSessionId(shellArgs: readonly string[], sessionId: string): string[] {
  if (shellArgs.some((a) => SESSION_FLAGS.includes(a) || a.startsWith("--session-id="))) return [...shellArgs];
  return [...shellArgs, "--session-id", sessionId];
}

/** The storage key holding the agent session's id for a workspace. */
export function agentSessionKey(workspaceUri: string): string {
  return `spexr.agent.session:${workspaceUri}`;
}
