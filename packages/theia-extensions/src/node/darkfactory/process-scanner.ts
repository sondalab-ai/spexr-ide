import { execFile } from "node:child_process";

/** Injectable runners so tests never spawn real processes. */
export interface ScannerDeps {
  runPs: () => Promise<string>;
  runLsofCwd: (pid: number) => Promise<string>;
}

/** PIDs whose process command name (from `ps -Ao pid,comm`) is one of `names`. */
export function parseAgentPids(psStdout: string, names: string[]): number[] {
  const want = new Set(names);
  const pids: number[] = [];
  for (const line of psStdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m && want.has(m[2]!.trim())) pids.push(Number(m[1]));
  }
  return pids;
}

/** Back-compat wrapper: PIDs whose command name is exactly `claude`. */
export function parseClaudePids(psStdout: string): number[] {
  return parseAgentPids(psStdout, ["claude"]);
}

/** Working directory from `lsof -p <pid> -d cwd -Fn` output (the `n`-prefixed line). */
export function parseCwd(lsofStdout: string): string | undefined {
  for (const line of lsofStdout.split("\n")) {
    if (line.startsWith("n")) return line.slice(1);
  }
  return undefined;
}

/**
 * `lsof` args to read one pid's cwd. `-a` ANDs the -p (pid) and -d (fd)
 * selectors; without it lsof ORs them and lists the cwd of EVERY process, so
 * {@link parseCwd} picks a bogus first match ("/").
 */
export function lsofCwdArgs(pid: number): string[] {
  return ["-a", "-p", String(pid), "-d", "cwd", "-Fn"];
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err && !stdout) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Working directories of all running agent processes (by name), or `null` when
 * detection failed (caller falls back to modified-time-only liveness).
 */
export async function liveProjectDirs(
  deps?: ScannerDeps,
  timeoutMs = 1500,
  names: string[] = ["claude"],
): Promise<Set<string> | null> {
  const runPs = deps?.runPs ?? (() => run("ps", ["-Ao", "pid,comm"], timeoutMs));
  const runLsofCwd =
    deps?.runLsofCwd ?? ((pid: number) => run("lsof", lsofCwdArgs(pid), timeoutMs));
  try {
    const pids = parseAgentPids(await runPs(), names);
    const dirs = new Set<string>();
    await Promise.all(
      pids.map(async (pid) => {
        try {
          const cwd = parseCwd(await runLsofCwd(pid));
          if (cwd) dirs.add(cwd);
        } catch {
          /* skip this pid */
        }
      }),
    );
    return dirs;
  } catch {
    return null;
  }
}
