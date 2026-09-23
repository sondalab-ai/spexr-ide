import { spawn } from "node:child_process";

export interface RunResult {
  /** Exit code; null when the process was killed (timeout) or failed to start. */
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Asynchronous stand-in for `spawnSync(cmd, args, { input, timeout })`: feed
 * `input` on stdin, collect stdout/stderr, and kill the process after
 * `timeoutMs`. The synchronous version freezes the whole backend (every RPC,
 * the wall, the terminals) for as long as the child runs.
 */
export function runWithInput(
  cmd: string,
  args: readonly string[],
  opts: { cwd: string; input: string; timeoutMs: number },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill("SIGTERM"), opts.timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: stderr || err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });
    child.stdin.on("error", () => {
      /* child exited before reading its input; its exit status tells the story */
    });
    child.stdin.end(opts.input);
  });
}
