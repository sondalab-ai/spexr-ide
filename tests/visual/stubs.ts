import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { PreparedRun } from "./prepare";

/** What {@link startLiveStubs} started, and how to stop it. */
export interface LiveStubs {
  readonly pids: readonly number[];
  readonly dirs: readonly string[];
  /** SIGTERM to every stub; safe to call twice. */
  stop(): void;
}

/** The first `sleep` on PATH, resolved: the stub is a link to it. */
function findSleep(): string {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, "sleep");
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }
  throw new Error("no sleep on PATH to stand in for a running claude");
}

/**
 * One long-lived process per live agent, which Dark Factory's scanner counts
 * as a running `claude` in that directory: it matches `ps -Ao pid,comm` on
 * the command name `claude`, then reads the working directory with lsof.
 *
 * What `comm` reports differs by OS, so a shebang script is not enough:
 * - Linux: the basename of the file that was exec'd. The stub is therefore a
 *   link named `claude` to `sleep`, which a script named `claude` would also
 *   give, but a script exec'd as `claude` through `exec -a` would not (that
 *   changes argv[0] only, and Linux reports `sleep`).
 * - macOS: argv[0] as it was exec'd; a shebang script reports its interpreter
 *   (`/bin/sh`). The link plus `argv0: "claude"` gives `claude` there too.
 *
 * Started only by the capture, which runs on a GitHub Actions runner, and
 * stopped when the app closes. Each directory is a realpath, because lsof
 * reports the resolved one and the transcripts' `cwd` is compared to it.
 */
export function startLiveStubs(run: PreparedRun, dirs: readonly string[]): LiveStubs {
  const link = path.join(run.root, "stubs", "claude");
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.rmSync(link, { force: true });
  fs.symlinkSync(findSleep(), link);
  const pids: number[] = [];
  for (const cwd of dirs) {
    const child = spawn(link, ["86400"], { cwd, argv0: "claude", detached: true, stdio: "ignore" });
    child.unref();
    if (child.pid === undefined) throw new Error(`the claude stub did not start in ${cwd}`);
    pids.push(child.pid);
  }
  return {
    pids,
    dirs,
    stop: () => {
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }
    },
  };
}

/** What the scanner would see of the stubs on this machine: `ps -Ao pid,comm` lines for `claude`, and each one's cwd. */
export interface ProcessProbe {
  /** `ps -Ao pid,comm` lines whose command name is exactly `claude`, as `pid comm`. */
  readonly psClaude: readonly string[];
  /** `lsof -a -p <pid> -d cwd -Fn`'s cwd for each stub pid; `null` when lsof gave none. */
  readonly cwd: Readonly<Record<string, string | null>>;
  /** Whether an `lsof` binary ran at all. */
  readonly lsof: boolean;
  readonly error?: string;
}

/**
 * The same two reads process-scanner.ts makes, run for the stubs' pids, and
 * kept in meta.json: it is how this fixture's detection is verified on the
 * Linux and macOS runners.
 */
export function probeProcesses(execFile: (cmd: string, args: string[]) => string, pids: readonly number[]): ProcessProbe {
  try {
    const psClaude = execFile("ps", ["-Ao", "pid,comm"])
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\d+\s+claude$/.test(l));
    let lsof = true;
    const cwd: Record<string, string | null> = {};
    for (const pid of pids) {
      try {
        const out = execFile("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]);
        cwd[String(pid)] = out.split("\n").find((l) => l.startsWith("n"))?.slice(1) ?? null;
      } catch {
        lsof = false;
        cwd[String(pid)] = null;
      }
    }
    return { psClaude, cwd, lsof };
  } catch (err) {
    return { psClaude: [], cwd: {}, lsof: false, error: String(err) };
  }
}
