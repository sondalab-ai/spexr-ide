import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckQueue, LineTail, runCheck, type CheckRequest, type CheckResult } from "./check-runner.js";

const dirs: string[] = [];
const strays: number[] = [];
afterEach(async () => {
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "spexr-check-"));
  dirs.push(d);
  return d;
}
const sh = { shell: "/bin/sh", killGraceMs: 200 };
const flush = () => new Promise((r) => setTimeout(r, 0));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
/** Polls: a killed process still answers `kill 0` until it has been reaped. */
async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return !alive(pid);
}

describe("LineTail", () => {
  it("keeps the last lines, the unfinished one included", () => {
    const t = new LineTail(3);
    t.push("a\nb\nc\n");
    t.push("d\ne");
    expect(t.text()).toBe("c\nd\ne");
  });
  it("drops colour codes", () => {
    const t = new LineTail(5);
    t.push("\x1b[31mFAIL\x1b[0m x\n");
    expect(t.text()).toBe("FAIL x");
  });
  it("bounds a line that never ends", () => {
    const t = new LineTail(5);
    for (let i = 0; i < 100; i++) t.push("x".repeat(1_000));
    expect(t.text().length).toBeLessThanOrEqual(2_000);
  });
});

describe("runCheck", () => {
  it("passes on exit 0, in the workspace", async () => {
    const cwd = await tmp();
    expect(await runCheck({ command: "pwd -P", cwd, timeoutMs: 5_000 }, sh)).toEqual({ ok: true, tail: await realpath(cwd) });
  });

  it("fails on a non-zero exit and keeps the last 40 lines", async () => {
    const cwd = await tmp();
    const r = await runCheck(
      { command: "i=0; while [ $i -lt 50 ]; do i=$((i+1)); echo line $i; done; exit 3", cwd, timeoutMs: 5_000 },
      sh,
    );
    expect(r.ok).toBe(false);
    const lines = r.tail.split("\n");
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe("line 11");
    expect(lines.at(-1)).toBe("line 50");
  });

  it("keeps what the command wrote to stderr", async () => {
    const cwd = await tmp();
    expect(await runCheck({ command: "echo oops >&2; exit 1", cwd, timeoutMs: 5_000 }, sh)).toEqual({ ok: false, tail: "oops" });
  });

  it("kills the whole process group on timeout: a child sleep is gone too", async () => {
    const cwd = await tmp();
    const pidFile = join(cwd, "child.pid");
    const r = await runCheck({ command: `sleep 30 & echo $! > '${pidFile}'; wait`, cwd, timeoutMs: 1_000 }, sh);
    expect(r.ok).toBe(false);
    expect(r.tail).toContain("timed out");
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    strays.push(pid);
    expect(await goneWithin(pid, 2_000)).toBe(true);
  });

  it("does not report a check that exited cleanly as timed out, even with an escaped helper still holding the pipes open (regression)", async () => {
    const cwd = await tmp();
    const pidFile = join(cwd, "regression.pid");
    const r = await runCheck(
      {
        command: `perl -MPOSIX -e 'POSIX::setsid(); open(my $f, ">", "${pidFile}"); print $f $$; close $f; sleep 30' & sleep 0.3; exit 0`,
        cwd,
        timeoutMs: 600,
      },
      sh,
    );
    strays.push(Number((await readFile(pidFile, "utf8")).trim()));
    expect(r.ok).toBe(true);
    expect(r.tail).not.toContain("timed out");
  });

  it("escalates to SIGKILL when the group ignores SIGTERM", async () => {
    const cwd = await tmp();
    const started = Date.now();
    const r = await runCheck({ command: "trap '' TERM; sleep 30", cwd, timeoutMs: 200 }, sh);
    expect(r.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("kills what the shell left running in its group once it exits", async () => {
    const cwd = await tmp();
    const pidFile = join(cwd, "left.pid");
    const r = await runCheck({ command: `sleep 30 & echo $! > '${pidFile}'; exit 0`, cwd, timeoutMs: 5_000 }, sh);
    expect(r.ok).toBe(true);
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    strays.push(pid);
    expect(await goneWithin(pid, 2_000)).toBe(true);
  });

  it("returns even when a process outside the group keeps the output open", async () => {
    const cwd = await tmp();
    const pidFile = join(cwd, "escaped.pid");
    const started = Date.now();
    const r = await runCheck(
      {
        // Waits for the pidfile rather than a fixed sleep: a slow perl start
        // under load must not race the shell's own exit past it.
        command: `perl -MPOSIX -e 'POSIX::setsid(); open(my $f, ">", "${pidFile}"); print $f $$; close $f; sleep 30' & until [ -f '${pidFile}' ]; do sleep 0.02; done; exit 0`,
        cwd,
        timeoutMs: 5_000,
      },
      sh,
    );
    strays.push(Number((await readFile(pidFile, "utf8")).trim()));
    expect(r.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_500);
  });

  it("reports a check that cannot start instead of throwing", async () => {
    const r = await runCheck({ command: "true", cwd: "/nonexistent-spexr-check", timeoutMs: 1_000 }, sh);
    expect(r.ok).toBe(false);
    expect(r.tail).toContain("could not start");
  });
});

describe("CheckQueue", () => {
  const req = (command: string): CheckRequest => ({ command, cwd: "/", timeoutMs: 1_000 });

  it("runs one check at a time, in the order asked, and survives a check that throws", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const gates = new Map<string, () => void>();
    const q = new CheckQueue(async (r): Promise<CheckResult> => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(r.command);
      await new Promise<void>((resolve) => gates.set(r.command, resolve));
      active--;
      if (r.command === "b") throw new Error("spawn blew up");
      return { ok: true, tail: r.command };
    });
    const a = q.run(req("a"), () => true);
    const b = q.run(req("b"), () => true);
    const c = q.run(req("c"), () => true);
    await flush();
    expect(order).toEqual(["a"]);
    gates.get("a")!();
    expect(await a).toEqual({ ok: true, tail: "a" });
    await flush();
    expect(order).toEqual(["a", "b"]);
    gates.get("b")!();
    await expect(b).rejects.toThrow("spawn blew up");
    await flush();
    gates.get("c")!();
    expect(await c).toEqual({ ok: true, tail: "c" });
    expect(order).toEqual(["a", "b", "c"]);
    expect(maxActive).toBe(1);
  });

  it("skips a check nobody wants any more once its turn comes", async () => {
    const ran: string[] = [];
    const q = new CheckQueue(async (r) => (ran.push(r.command), { ok: true, tail: "" }));
    let wanted = true;
    const first = q.run(req("a"), () => true);
    const second = q.run(req("b"), () => wanted);
    wanted = false; // e.g. its run was aborted while "a" ran
    await first;
    expect(await second).toBeUndefined();
    expect(ran).toEqual(["a"]);
  });

  it("two tasks' real checks never overlap (Review Focus 5)", async () => {
    const cwd = await tmp();
    const log = join(cwd, "order.log");
    const q = new CheckQueue((r) => runCheck(r, sh));
    const check = (name: string): CheckRequest => ({
      command: `echo start-${name} >> '${log}'; sleep 0.2; echo end-${name} >> '${log}'`,
      cwd,
      timeoutMs: 5_000,
    });
    await Promise.all([q.run(check("a"), () => true), q.run(check("b"), () => true)]);
    expect((await readFile(log, "utf8")).trim().split("\n")).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });
});
