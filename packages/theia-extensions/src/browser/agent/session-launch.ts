import { shellQuoteConfigDir, type LaunchPlan } from "../../common/claude-launch-profiles.js";

/**
 * The session id the agent terminal's Claude is started with (`--session-id`),
 * so the agent pane can follow that session's transcript without guessing
 * which one is the terminal's. Pure: the manager generates, persists and uses it.
 */

/** Flags that already name or choose the session: appending `--session-id` to them would be refused or wrong. */
const SESSION_FLAGS = ["--session-id", "--resume", "-r", "--continue", "-c"];

/**
 * The shell args with `--session-id <id>` appended, and whether it was: the
 * args already carrying a flag that decides the session are left alone, and
 * then the id is not the session's, so nothing may remember it. Appended last,
 * which is where a launch profile's wrapper command receives it too (the args
 * follow the command in the `-c` line, see {@link launchLine}).
 */
export function withSessionId(shellArgs: readonly string[], sessionId: string): { args: string[]; applied: boolean } {
  if (shellArgs.some((a) => SESSION_FLAGS.includes(a) || a.startsWith("--session-id="))) return { args: [...shellArgs], applied: false };
  return { args: [...shellArgs, "--session-id", sessionId], applied: true };
}

/** Wrap an argument in single quotes for safe inclusion in a shell command. */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The line the login shell runs (`-i -l -c <line>`): the account first, set
 * authoritatively (`export CLAUDE_CONFIG_DIR` for a profile that carries one,
 * `unset` otherwise), then the command and its arguments. A wrapper command is
 * spliced unquoted so an alias expands; the arguments, the session id among
 * them, follow it quoted.
 */
export function launchLine(plan: LaunchPlan, shellArgs: readonly string[]): string {
  const bin = plan.unquoted ? plan.command : shellQuote(plan.command);
  const account = plan.exportConfigDir ? `export CLAUDE_CONFIG_DIR=${shellQuoteConfigDir(plan.exportConfigDir)}` : "unset CLAUDE_CONFIG_DIR";
  return `${account}; ${[bin, ...shellArgs.map(shellQuote)].join(" ")}`;
}

/** The storage key holding the agent session's id for a workspace. */
export function agentSessionKey(workspaceUri: string): string {
  return `spexr.agent.session:${workspaceUri}`;
}
