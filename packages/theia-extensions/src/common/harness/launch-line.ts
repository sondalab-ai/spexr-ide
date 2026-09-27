import { shellQuoteConfigDir, type LaunchPlan } from "../claude-launch-profiles.js";

/** Wrap an argument in single quotes for safe inclusion in a shell command. */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `-c` line a login shell runs to start a harness (spec 0011 AC-8): the
 * account is exported or unset inside the line, then `cd`, then the harness
 * with every argument quoted. The command is quoted only when it is a path, so
 * a shell alias still expands. `keepShell` appends `exec "$SHELL" -i`, which
 * the wall wants (a failed resume stays readable) and a scheduled task must
 * not have (its harness exiting has to end the pty).
 */
export function buildLaunchLine(o: {
  plan: LaunchPlan;
  args: string[];
  cwd: string;
  ownsAccount: boolean;
  keepShell: boolean;
}): string {
  const account = o.plan.exportConfigDir
    ? `export CLAUDE_CONFIG_DIR=${shellQuoteConfigDir(o.plan.exportConfigDir)}`
    : "unset CLAUDE_CONFIG_DIR";
  const prefix = [o.ownsAccount ? account : "", o.cwd ? `cd ${shellQuote(o.cwd)}` : ""].filter(Boolean).join("; ");
  const bin = o.plan.unquoted ? o.plan.command : shellQuote(o.plan.command);
  const run = [bin, ...o.args.map(shellQuote)].join(" ");
  return `${prefix ? `${prefix}; ` : ""}${run}${o.keepShell ? `; exec "$SHELL" -i` : ""}`;
}
