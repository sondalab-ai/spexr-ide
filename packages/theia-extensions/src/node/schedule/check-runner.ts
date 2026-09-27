import { spawn, type ChildProcess } from "node:child_process";

/** Lines of a failed check's output carried into the follow-up (spec, Turn end and convergence). */
export const CHECK_TAIL_LINES = 40;
/** Time a check's process group gets between SIGTERM and SIGKILL once it has timed out. */
export const CHECK_KILL_GRACE_MS = 5_000;
/** After the shell exits, how long its output may still drain before the result is taken. */
const DRAIN_MS = 500;
/** A longer line is cut: output with no newline must not grow without bound. */
const MAX_LINE_CHARS = 2_000;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export interface CheckRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
}

export interface CheckResult {
  ok: boolean;
  /** The last CHECK_TAIL_LINES lines of stdout and stderr, in arrival order, colour codes removed. */
  tail: string;
}

export interface CheckOptions {
  /** Defaults to `$SHELL`, else `/bin/sh`. */
  shell?: string;
  killGraceMs?: number;
}

/** Keeps the last `max` lines of a text stream; the unfinished last line counts as one. */
export class LineTail {
  private lines: string[] = [];
  private partial = "";

  constructor(private readonly max: number) {}

  push(chunk: string): void {
    const parts = (this.partial + chunk).split(/\r?\n/);
    this.partial = parts.pop()!.slice(-MAX_LINE_CHARS);
    for (const p of parts) this.lines.push(p.slice(0, MAX_LINE_CHARS));
    if (this.lines.length > this.max) this.lines = this.lines.slice(-this.max);
  }

  text(): string {
    const all = this.partial ? [...this.lines, this.partial] : this.lines;
    return all.slice(-this.max).join("\n").replace(ANSI, "");
  }
}

/**
 * Run a task's check command: `<shell> -l -c <command>` in the workspace, as
 * the leader of its own process group. On timeout the whole group gets SIGTERM,
 * then SIGKILL after the grace. Once the shell exits, whatever it left in its
 * group is killed as well, so nothing overlaps the next check. The result is
 * taken on exit plus a short drain, never on the pipes closing alone: a process
 * that left the group can hold them open for ever. Never rejects.
 */
export function runCheck(req: CheckRequest, o: CheckOptions = {}): Promise<CheckResult> {
  const shell = o.shell ?? process.env.SHELL ?? "/bin/sh";
  const grace = o.killGraceMs ?? CHECK_KILL_GRACE_MS;
  return new Promise((resolve) => {
    const tail = new LineTail(CHECK_TAIL_LINES);
    let child: ChildProcess;
    try {
      child = spawn(shell, ["-l", "-c", req.command], {
        cwd: req.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ ok: false, tail: `The check could not start: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    let timedOut = false;
    let settled = false;
    const killGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* ESRCH: the group is already gone */
      }
    };
    const finish = (ok: boolean, note?: string): void => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (note) tail.push(`\n${note}\n`);
      resolve({ ok, tail: tail.text() });
    };
    child.stdout?.setEncoding("utf8").on("data", (d: string) => tail.push(d));
    child.stderr?.setEncoding("utf8").on("data", (d: string) => tail.push(d));
    child.once("error", (err) => finish(false, `The check could not start: ${err.message}`));
    timers.push(
      setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        timers.push(setTimeout(() => killGroup("SIGKILL"), grace));
      }, req.timeoutMs),
    );
    child.once("exit", (code) => {
      killGroup("SIGKILL");
      const done = (): void =>
        finish(
          !timedOut && code === 0,
          timedOut ? `[the check timed out after ${req.timeoutMs / 1000} s and was stopped]` : undefined,
        );
      child.once("close", done);
      timers.push(setTimeout(done, DRAIN_MS));
    });
  });
}

/**
 * Runs checks one at a time, in the order they were asked for. One instance
 * serves the whole backend: parallel tasks each running `pnpm test` at once
 * would overload the machine (it crashed on 2026-09-24). `stillWanted` is asked
 * when a check's turn comes; false skips it (its run was aborted meanwhile).
 */
export class CheckQueue {
  private last: Promise<unknown> = Promise.resolve();

  constructor(private readonly exec: (req: CheckRequest) => Promise<CheckResult>) {}

  run(req: CheckRequest, stillWanted: () => boolean): Promise<CheckResult | undefined> {
    const next = this.last.then(() => (stillWanted() ? this.exec(req) : undefined));
    this.last = next.catch(() => undefined);
    return next;
  }
}
