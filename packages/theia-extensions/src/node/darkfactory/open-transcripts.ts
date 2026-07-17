import { execFile } from "node:child_process";

/** Injectable command runner so tests never spawn a real process. */
export interface LsofDeps {
  run: () => Promise<string>;
}

/** Keep only lines that are `.jsonl` files under `projectsDir`. */
export function parseLsofOutput(stdout: string, projectsDir: string): Set<string> {
  const set = new Set<string>();
  for (const raw of stdout.split("\n")) {
    const path = raw.trim();
    if (path.endsWith(".jsonl") && path.startsWith(projectsDir)) set.add(path);
  }
  return set;
}

function defaultRun(projectsDir: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // -c claude: files opened by processes named "claude"; -Fn: output file names, one per line.
    execFile("lsof", ["-c", "claude", "-Fn"], { timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout) => {
      // lsof exits non-zero when *some* pids are inaccessible even though stdout is valid;
      // only reject when there is no usable output at all.
      if (err && !stdout) reject(err);
      else resolve(stripFnPrefix(stdout));
    });
  });
}

/** `-Fn` lines are prefixed with `n`; drop that and non-`n` records. */
function stripFnPrefix(stdout: string): string {
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("n"))
    .map((l) => l.slice(1))
    .join("\n");
}

/**
 * Transcript paths currently open by a `claude` process, or `null` when
 * detection failed (caller then falls back to modified-time-only classification).
 */
export async function openTranscriptPaths(
  projectsDir: string,
  deps?: LsofDeps,
  timeoutMs = 1500,
): Promise<Set<string> | null> {
  try {
    const stdout = deps ? await deps.run() : await defaultRun(projectsDir, timeoutMs);
    return parseLsofOutput(stdout, projectsDir);
  } catch {
    return null;
  }
}
