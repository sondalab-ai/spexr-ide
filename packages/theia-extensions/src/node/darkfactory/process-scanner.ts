import { execFile } from "node:child_process";

/** Injectable runners so tests never spawn real processes. */
export interface ScannerDeps {
  runPs: () => Promise<string>;
  runLsofCwd: (pid: number) => Promise<string>;
}

/** PIDs whose process command name is exactly `claude` (from `ps -Ao pid,comm`). */
export function parseClaudePids(psStdout: string): number[] {
  const pids: number[] = [];
  for (const line of psStdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m && m[2]!.trim() === "claude") pids.push(Number(m[1]));
  }
  return pids;
}

/** Working directory from `lsof -p <pid> -d cwd -Fn` output (the `n`-prefixed line). */
export function parseCwd(lsofStdout: string): string | undefined {
  for (const line of lsofStdout.split("\n")) {
    if (line.startsWith("n")) return line.slice(1);
  }
  return undefined;
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
 * Working directories of all running `claude` processes, or `null` when
 * detection failed (caller falls back to modified-time-only liveness).
 */
export async function liveProjectDirs(deps?: ScannerDeps, timeoutMs = 1500): Promise<Set<string> | null> {
  const runPs = deps?.runPs ?? (() => run("ps", ["-Ao", "pid,comm"], timeoutMs));
  const runLsofCwd =
    deps?.runLsofCwd ?? ((pid: number) => run("lsof", ["-p", String(pid), "-d", "cwd", "-Fn"], timeoutMs));
  try {
    const pids = parseClaudePids(await runPs());
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
