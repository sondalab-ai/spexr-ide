import { describe, expect, it } from "vitest";
import type { Schedule, TaskLaunch } from "../../common/schedule/schedule-types.js";
import { ScheduleRunner, type RunnerPorts } from "./schedule-runner.js";
import type { WatchEvent } from "./claude-task-watcher.js";
import type { ScheduleFile } from "./schedule-store.js";
import type { CheckRequest, CheckResult } from "./check-runner.js";
import type { WorktreeRequest } from "./workspace.js";
import { followUpPrompt } from "../../common/schedule/schedule-prompt.js";

const launch: TaskLaunch = { plan: { command: "claude", exportConfigDir: "", unquoted: true }, configDir: "" };
const schedule: Schedule = {
  id: "s",
  name: "S",
  tasks: [{ id: "a", name: "A", needs: [], project: "/repo", workspace: { kind: "folder" }, harness: "claude", prompt: "Go." }],
};

function fakes() {
  const lines: string[] = [];
  const names: [string, string][] = [];
  const log: string[] = [];
  const checks: CheckRequest[] = [];
  const closes: [number, number][] = [];
  let checkResult: CheckResult = { ok: true, tail: "" };
  let watch: ((e: WatchEvent) => void) | undefined;
  let exit: (() => void) | undefined;
  let saved: ScheduleFile | undefined;
  const ports: RunnerPorts = {
    launch: async (line) => (lines.push(line), { terminalId: 3, processId: 30 }),
    onExit: (_id, l) => ((exit = l), () => (exit = undefined)),
    watchClaude: (_req, l) => ((watch = l), { stop: () => (watch = undefined), arm: () => void log.push("arm") }),
    watchOpencode: () => ({ stop: () => {}, arm: () => {} }),
    rename: async (id, name) => void names.push([id, name]),
    newSessionId: () => "u-1",
    now: () => 1,
    save: async (f) => void (saved = structuredClone(f)),
    publish: () => {},
    paste: async (terminalId, text) => void log.push(`paste:${terminalId}:${text}`),
    check: async (req, stillWanted) => {
      if (!stillWanted()) return undefined;
      checks.push(req);
      return checkResult;
    },
    close: async (id, pid) => void closes.push([id, pid]),
    prepareWorktree: async (req) => `/wt/${req.taskId}`,
  };
  return {
    ports,
    lines,
    names,
    log,
    checks,
    closes,
    setCheck: (r: CheckResult) => void (checkResult = r),
    emit: (e: WatchEvent) => watch!(e),
    exit: () => exit!(),
    saved: () => saved,
    watching: () => !!watch,
  };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (err: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("ScheduleRunner", () => {
  it("launches a Claude task with its session id and prompt, and converges on its turn end", async () => {
    const f = fakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    expect(await runner.run("s", { a: launch })).toEqual([]);
    await settle();
    expect(f.lines).toEqual([`unset CLAUDE_CONFIG_DIR; cd '/repo'; claude '--session-id' 'u-1' 'Go.'`]);
    f.emit({ type: "session-found", sessionId: "u-1" });
    await settle();
    expect(f.names).toEqual([["u-1", "S · A (1/1)"]]);
    f.emit({ type: "turn-ended", reply: "ok" });
    await settle();
    expect(f.saved()!.runs["s"]!.status).toBe("finished");
    expect(f.watching()).toBe(false); // watcher released once the task settled
  });

  it("refuses to run an invalid schedule or one already running", async () => {
    const f = fakes();
    const bad = { ...schedule, tasks: [{ ...schedule.tasks[0]!, prompt: "" }] };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [bad], runs: {} });
    expect((await runner.run("s", { a: launch })).length).toBeGreaterThan(0);
    const ok = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await ok.run("s", { a: launch });
    expect(await ok.run("s", { a: launch })).toEqual([{ field: "run", message: "This schedule is already running." }]);
  });

  it("fails the task when the pty exits first", async () => {
    const f = fakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    f.exit();
    await settle();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("failed");
  });

  it("marks tasks interrupted when it starts over a run left running (AC-16)", async () => {
    const f = fakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    const restarted = new ScheduleRunner(f.ports, f.saved()!);
    await restarted.recover();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("interrupted");
  });

  it("starts only one run when two run() calls overlap on a busy queue", async () => {
    const f = fakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    const [first, second] = await Promise.all([runner.run("s", { a: launch }), runner.run("s", { a: launch })]);
    await settle();
    expect(first).toEqual([]);
    expect(second).toEqual([{ field: "run", message: "This schedule is already running." }]);
    expect(f.lines.length).toBe(1); // one pty per task, not two
  });

  it("does not bind a rerun's task to the previous run's terminal, and leaves only the rerun's watcher registered", async () => {
    const f = fakes();
    type Terminal = { terminalId: number; processId: number };
    const pending: { line: string; resolve: (t: Terminal) => void }[] = [];
    f.ports.launch = (line) => new Promise<Terminal>((resolve) => pending.push({ line, resolve }));
    const watchCalls: string[] = [];
    const stopped: string[] = [];
    f.ports.watchClaude = (req, _l) => {
      watchCalls.push(req.sessionId);
      return { stop: () => stopped.push(req.sessionId), arm: () => {} };
    };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });

    await runner.run("s", { a: launch });
    await settle();
    expect(pending.length).toBe(1); // run 1's launch is pending, nothing registered yet
    const run1Launch = pending.shift()!;

    await runner.abort("s");
    await settle();

    await runner.run("s", { a: launch });
    await settle();
    expect(pending.length).toBe(1); // run 2 also launched
    const run2Launch = pending.shift()!;

    // Run 1's launch resolves late, after run 2 already owns the task.
    run1Launch.resolve({ terminalId: 1, processId: 10 });
    await settle();
    run2Launch.resolve({ terminalId: 2, processId: 20 });
    await settle();

    const run = f.saved()!.runs["s"]!;
    expect(run.tasks["a"]!.status).toBe("running");
    expect(run.tasks["a"]!.terminalId).toBe(2); // bound to run 2's terminal, never run 1's
    expect(watchCalls).toEqual(["u-1"]); // only run 2 ever registered a watcher
    expect(stopped).toEqual([]); // nothing was registered for run 1, so nothing needed releasing
    expect(f.closes).toEqual([[1, 10]]); // R14: run 1's pty had no card and nothing watching it
  });

  it("does not fail a rerun's task when the previous run's launch rejects late", async () => {
    const f = fakes();
    type Terminal = { terminalId: number; processId: number };
    const pending: { line: string; resolve: (t: Terminal) => void; reject: (err: unknown) => void }[] = [];
    f.ports.launch = (line) => new Promise<Terminal>((resolve, reject) => pending.push({ line, resolve, reject }));
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });

    await runner.run("s", { a: launch });
    await settle();
    const run1Launch = pending.shift()!;

    await runner.abort("s");
    await settle();

    await runner.run("s", { a: launch });
    await settle();
    const run2Launch = pending.shift()!;

    // Run 1's launch rejects late, after run 2 already owns the task: its
    // failure must not be attributed to run 2's task.
    run1Launch.reject(new Error("run 1's pty never started"));
    await settle();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("starting"); // unaffected by run 1's rejection

    run2Launch.resolve({ terminalId: 2, processId: 20 });
    await settle();
    const run = f.saved()!.runs["s"]!;
    expect(run.tasks["a"]!.status).toBe("running");
    expect(run.tasks["a"]!.terminalId).toBe(2);
  });

  it("fails the task when registering its watcher throws, without ever registering the exit listener", async () => {
    const f = fakes();
    let onExitCalled = false;
    f.ports.watchClaude = () => {
      throw new Error("boom");
    };
    f.ports.onExit = () => {
      onExitCalled = true;
      return () => {};
    };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    const run = f.saved()!.runs["s"]!;
    expect(run.tasks["a"]!.status).toBe("failed");
    expect(run.tasks["a"]!.error).toBe("boom");
    expect(onExitCalled).toBe(false); // watchClaude threw before onExit was ever attempted
  });

  it("fails the task when registering its exit listener throws, releasing the watcher it already opened", async () => {
    const f = fakes();
    let watchStopped = false;
    f.ports.watchClaude = () => ({ stop: () => (watchStopped = true), arm: () => {} });
    f.ports.onExit = () => {
      throw new Error("boom");
    };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    const run = f.saved()!.runs["s"]!;
    expect(run.tasks["a"]!.status).toBe("failed");
    expect(run.tasks["a"]!.error).toBe("boom");
    expect(watchStopped).toBe(true); // the watcher opened before the throw was released
  });

  it("saveSchedule and removeSchedule refuse a running schedule; removeSchedule drops its run state", async () => {
    const f = fakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();

    expect(await runner.saveSchedule(schedule)).toEqual([
      { field: "run", message: "Abort the run before editing its schedule." },
    ]);
    await expect(runner.removeSchedule("s")).rejects.toThrow("Abort the run before deleting its schedule.");
    expect(f.saved()!.schedules).toEqual([schedule]);
    expect(f.saved()!.runs["s"]).toBeDefined();

    await runner.abort("s");
    await settle();
    await runner.removeSchedule("s");
    expect(f.saved()!.schedules).toEqual([]);
    expect(f.saved()!.runs["s"]).toBeUndefined();
  });

  it("drops a superseded run's late started event even when Abort/Run were queued behind a busy queue (reviewer repro)", async () => {
    const f = fakes();
    type Terminal = { terminalId: number; processId: number };
    const pending: { resolve: (t: Terminal) => void }[] = [];
    f.ports.launch = () => new Promise<Terminal>((resolve) => pending.push({ resolve }));
    let nextSessionId = 0;
    f.ports.newSessionId = () => `u-${++nextSessionId}`; // distinguishes run 1's session from run 2's
    const registrations: string[] = [];
    f.ports.watchClaude = (req, _l) => {
      registrations.push(`watch:${req.sessionId}`);
      return { stop: () => registrations.push(`unwatch:${req.sessionId}`), arm: () => {} };
    };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });

    // Start run 1; its launch stays pending.
    await runner.run("s", { a: launch });
    await settle();
    const run1Launch = pending.shift()!;

    // Occupy the queue with a save that will not resolve until released.
    const blockedSave = deferred<void>();
    const originalSave = f.ports.save;
    f.ports.save = (file) => blockedSave.promise.then(() => originalSave(file));
    const blockingSave = runner.saveSchedule({ id: "t", name: "T", tasks: [] });

    // Queue Abort and Run behind the blocked save: neither has been applied yet.
    const abortDone = runner.abort("s");
    const rerun = runner.run("s", { a: launch });

    // Run 1's launch resolves now, while the queue is still blocked, so its
    // perform() still reads run 1 as current: it registers a watcher for
    // session u-1 (the busy queue lets this stale registration through — see
    // schedule-runner.ts's isCurrentRun() comment) and queues a "started"
    // dispatch bound to run 1's id, behind Abort and Run.
    run1Launch.resolve({ terminalId: 1, processId: 10 });
    await settle();
    expect(pending.length).toBe(0); // run 2 has not launched yet — still queued behind the block
    expect(registrations).toEqual(["watch:u-1"]);

    // Release the queue: the blocked save, Abort, Run, then run 1's stale
    // "started" all process in that order. Abort's own commit() releases run
    // 1's registration (u-1 is stopped); run 2 then registers its own (u-2).
    blockedSave.resolve();
    await Promise.all([blockingSave, abortDone, rerun]);
    await settle();

    expect(pending.length).toBe(1); // run 2's own launch
    const run2Launch = pending.shift()!;
    run2Launch.resolve({ terminalId: 2, processId: 20 });
    await settle();

    expect(registrations).toEqual(["watch:u-1", "unwatch:u-1", "watch:u-2"]); // run 1's pair stopped, run 2's still live
    const run = f.saved()!.runs["s"]!;
    expect(run.tasks["a"]!.status).toBe("running");
    expect(run.tasks["a"]!.terminalId).toBe(2); // never bound to run 1's terminal (1)
    expect(run.tasks["a"]!.sessionId).toBe("u-2"); // never bound to run 1's session (u-1)
    expect(f.closes).toEqual([[1, 10]]); // R14: dispatch() dropped run 1's "started" and closed its pty
  });

  it("closes a stale started event whose run and schedule were removed while it was queued (R14)", async () => {
    const f = fakes();
    type Terminal = { terminalId: number; processId: number };
    const pending: { resolve: (t: Terminal) => void }[] = [];
    f.ports.launch = () => new Promise<Terminal>((resolve) => pending.push({ resolve }));
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });

    await runner.run("s", { a: launch });
    await settle();
    const run1Launch = pending.shift()!;

    // Occupy the queue the same way as the "reviewer repro" test above.
    const blockedSave = deferred<void>();
    const originalSave = f.ports.save;
    f.ports.save = (file) => blockedSave.promise.then(() => originalSave(file));
    const blockingSave = runner.saveSchedule({ id: "t", name: "T", tasks: [] });

    // Queue Abort then removeSchedule behind the blocked save: by the time
    // removeSchedule's own status check runs, Abort has already applied, so
    // it deletes both the run and the schedule.
    const abortDone = runner.abort("s");
    const removeDone = runner.removeSchedule("s");

    // Run 1's launch resolves while the queue is still blocked: it registers
    // (reading `this.file` outside the queue) and queues a "started" dispatch
    // bound to run 1, behind Abort and removeSchedule.
    run1Launch.resolve({ terminalId: 1, processId: 10 });
    await settle();

    blockedSave.resolve();
    await Promise.all([blockingSave, abortDone, removeDone]);
    await settle();

    expect(f.saved()!.runs["s"]).toBeUndefined(); // the run is gone, not merely superseded
    expect(f.closes).toEqual([[1, 10]]); // R14: a stale "started" for a run/schedule that no longer exist still gets closed
  });

  it("drops a late watcher/exit event from a run that Abort→Run already superseded", async () => {
    const f = fakes();
    type Terminal = { terminalId: number; processId: number };
    const pending: { resolve: (t: Terminal) => void }[] = [];
    f.ports.launch = () => new Promise<Terminal>((resolve) => pending.push({ resolve }));
    let run1Exit: (() => void) | undefined;
    f.ports.onExit = (_id, l) => {
      run1Exit = l;
      return () => {};
    };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });

    await runner.run("s", { a: launch });
    await settle();
    pending.shift()!.resolve({ terminalId: 1, processId: 10 }); // run 1 launches and registers
    await settle();
    expect(run1Exit).toBeDefined();

    // Occupy the queue the same way as the previous test.
    const blockedSave = deferred<void>();
    const originalSave = f.ports.save;
    f.ports.save = (file) => blockedSave.promise.then(() => originalSave(file));
    const blockingSave = runner.saveSchedule({ id: "t", name: "T", tasks: [] });
    const abortDone = runner.abort("s");
    const rerun = runner.run("s", { a: launch });

    // Run 1's exit listener fires late — the race the ruling calls out —
    // while Abort has been issued but not yet applied.
    run1Exit!();

    blockedSave.resolve();
    await Promise.all([blockingSave, abortDone, rerun]);
    await settle();

    const run2Launch = pending.shift()!;
    run2Launch.resolve({ terminalId: 2, processId: 20 });
    await settle();

    const run = f.saved()!.runs["s"]!;
    expect(run.tasks["a"]!.status).toBe("running"); // not "failed" from run 1's stale "exited"
    expect(run.tasks["a"]!.terminalId).toBe(2);
  });

  const looping: Schedule = {
    ...schedule,
    tasks: [
      {
        ...schedule.tasks[0]!,
        loop: { stopCriteria: "tests pass", followUp: "Keep going.", maxIterations: 3, check: "pnpm test", checkTimeoutSec: 30 },
      },
    ],
  };
  const start = async (f: ReturnType<typeof fakes>): Promise<ScheduleRunner> => {
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [looping], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    f.emit({ type: "session-found", sessionId: "u-1" });
    await settle();
    return runner;
  };

  it("re-arms the watcher before pasting the follow-up, and renames the session each iteration", async () => {
    const f = fakes();
    await start(f);
    f.emit({ type: "turn-ended", reply: "not yet" });
    await settle();
    expect(f.log).toEqual(["arm", `paste:3:${followUpPrompt(looping.tasks[0]!)}`]);
    expect(f.names).toEqual([
      ["u-1", "S · A (1/3)"],
      ["u-1", "S · A (2/3)"],
    ]);
    expect(f.saved()!.runs["s"]!.tasks["a"]).toMatchObject({ status: "running", iteration: 2 });
  });

  it("runs the check in the workspace once the reply ends with the marker; a pass converges", async () => {
    const f = fakes();
    await start(f);
    f.emit({ type: "turn-ended", reply: "done\nCONVERGED" });
    await settle();
    expect(f.checks).toEqual([{ command: "pnpm test", cwd: "/repo", timeoutMs: 30_000 }]);
    expect(f.saved()!.runs["s"]!.status).toBe("finished");
    expect(f.log).toEqual([]); // nothing pasted
  });

  it("a failed check pastes the follow-up with the check's output", async () => {
    const f = fakes();
    f.setCheck({ ok: false, tail: "FAIL a.test.ts" });
    await start(f);
    f.emit({ type: "turn-ended", reply: "done\nCONVERGED" });
    await settle();
    expect(f.log).toEqual([
      "arm",
      `paste:3:${followUpPrompt(looping.tasks[0]!, { command: "pnpm test", tail: "FAIL a.test.ts" })}`,
    ]);
  });

  it("does not run a queued check once its run was aborted (R9)", async () => {
    const f = fakes();
    let release: () => void = () => {};
    const wanted: boolean[] = [];
    f.ports.check = (_req, stillWanted) =>
      new Promise((resolve) => {
        release = () => {
          wanted.push(stillWanted());
          resolve(undefined);
        };
      });
    const runner = await start(f);
    f.emit({ type: "turn-ended", reply: "done\nCONVERGED" });
    await settle();
    await runner.abort("s");
    release();
    await settle();
    expect(wanted).toEqual([false]);
    expect(f.saved()!.runs["s"]!.status).toBe("aborted");
  });

  it("pause holds a turn end and resume replays it", async () => {
    const f = fakes();
    const runner = await start(f);
    await runner.pause("s");
    f.emit({ type: "turn-ended", reply: "not yet" });
    await settle();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("held");
    expect(f.log).toEqual([]);
    await runner.resume("s");
    await settle();
    expect(f.log).toEqual(["arm", `paste:3:${followUpPrompt(looping.tasks[0]!)}`]);
  });

  it("closes a launch that resolves after its run was aborted: it would have no card (R14)", async () => {
    const f = fakes();
    type Terminal = { terminalId: number; processId: number };
    const pending: ((t: Terminal) => void)[] = [];
    f.ports.launch = () => new Promise<Terminal>((resolve) => pending.push(resolve));
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    await runner.abort("s");
    pending.shift()!({ terminalId: 5, processId: 50 });
    await settle();
    expect(f.closes).toEqual([[5, 50]]);
    expect(f.watching()).toBe(false);
  });

  it("closes the pty when its watcher cannot be registered (R14)", async () => {
    const f = fakes();
    f.ports.watchClaude = () => {
      throw new Error("boom");
    };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("failed");
    expect(f.closes).toEqual([[3, 30]]);
  });

  it("a retry closes the failed session and launches a new one; Abort closes nothing (R13)", async () => {
    const f = fakes();
    let launchCount = 0;
    f.ports.launch = async (line) => {
      launchCount += 1;
      f.lines.push(line);
      return launchCount === 1 ? { terminalId: 3, processId: 30 } : { terminalId: 4, processId: 40 };
    };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    f.exit();
    await settle();
    await runner.dispatch("s", { type: "retry", task: "a", launch });
    await settle();
    expect(f.closes).toEqual([[3, 30]]); // the failed session, never the new one
    expect(f.lines).toHaveLength(2);
    expect(f.saved()!.runs["s"]!.tasks["a"]).toMatchObject({ status: "running", terminalId: 4 }); // bound to the new terminal, not the closed one
    await runner.abort("s");
    await settle();
    expect(f.closes).toEqual([[3, 30]]); // Abort keeps sessions open (spec)
  });

  it("closes exactly one pty when only Abort (no rerun) is queued behind a busy queue while its launch resolves (R14)", async () => {
    const f = fakes();
    type Terminal = { terminalId: number; processId: number };
    const pending: { resolve: (t: Terminal) => void }[] = [];
    f.ports.launch = () => new Promise<Terminal>((resolve) => pending.push({ resolve }));
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });

    await runner.run("s", { a: launch });
    await settle();
    const run1Launch = pending.shift()!;

    // Occupy the queue the same way as the "reviewer repro" test above.
    const blockedSave = deferred<void>();
    const originalSave = f.ports.save;
    f.ports.save = (file) => blockedSave.promise.then(() => originalSave(file));
    const blockingSave = runner.saveSchedule({ id: "t", name: "T", tasks: [] });

    // Only Abort is queued behind the block — no rerun this time, so the run
    // itself is never superseded, only stopped.
    const abortDone = runner.abort("s");

    // The launch resolves while the queue is still blocked: isCurrentRun()
    // still sees the run as "running" (Abort hasn't applied yet), so it
    // registers a watcher/exit listener and queues a "started" dispatch bound
    // to this run, behind the blocked save and Abort.
    run1Launch.resolve({ terminalId: 1, processId: 10 });
    await settle();

    // Release the queue: the blocked save, then Abort, then the queued
    // "started" all process in that order. Abort's own commit() releases the
    // registration it never needed; the queued "started" then finds the same
    // run no longer "running" (not stale — same runId, no rerun) and closes
    // its pty (dispatch()'s plain-Abort branch, R14).
    blockedSave.resolve();
    await Promise.all([blockingSave, abortDone]);
    await settle();

    expect(f.closes).toEqual([[1, 10]]);
    expect(f.watching()).toBe(false);
  });

  it("Skip closes nothing (spec) — only Retry's engine effect ever closes a session", async () => {
    const f = fakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    f.exit();
    await settle();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("failed");
    await runner.dispatch("s", { type: "skip", task: "a" });
    await settle();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("skipped");
    expect(f.closes).toEqual([]);
  });
});

describe("ScheduleRunner — the graph (Slice 4)", () => {
  type Terminal = { terminalId: number; processId: number };
  const graph: Schedule = {
    id: "s",
    name: "S",
    tasks: [
      { id: "a", name: "A", needs: [], project: "/repo", workspace: { kind: "worktree" }, harness: "claude", prompt: "do a" },
      { id: "b", name: "B", needs: [], project: "/repo", workspace: { kind: "worktree" }, harness: "claude", prompt: "do b" },
      { id: "c", name: "C", needs: ["a"], project: "/repo", workspace: { kind: "sameAs", task: "a" }, harness: "claude", prompt: "review {{a.workspace}}" },
    ],
  };
  const all = { a: launch, b: launch, c: launch };
  const sessionIn = (line: string): string => /'--session-id' '([^']+)'/.exec(line)![1]!;

  function graphFakes() {
    const launched: { line: string; cwd: string; resolve: (t: Terminal) => void }[] = [];
    const worktrees: WorktreeRequest[] = [];
    const watchers = new Map<string, (e: WatchEvent) => void>();
    const exits = new Map<number, () => void>();
    const closes: [number, number][] = [];
    let sessions = 0;
    let saved: ScheduleFile | undefined;
    const ports: RunnerPorts = {
      launch: (line, cwd) => new Promise<Terminal>((resolve) => launched.push({ line, cwd, resolve })),
      onExit: (id, l) => (exits.set(id, l), () => void exits.delete(id)),
      watchClaude: (req, l) => (watchers.set(req.sessionId, l), { stop: () => void watchers.delete(req.sessionId), arm: () => {} }),
      watchOpencode: () => ({ stop: () => {}, arm: () => {} }),
      rename: async () => {},
      newSessionId: () => `u-${++sessions}`,
      now: () => 1,
      save: async (f) => void (saved = structuredClone(f)),
      publish: () => {},
      paste: async () => {},
      check: async () => ({ ok: true, tail: "" }),
      close: async (id, pid) => void closes.push([id, pid]),
      prepareWorktree: async (req) => (worktrees.push(req), `/wt/${req.taskId}`),
    };
    return {
      ports,
      launched,
      worktrees,
      exits,
      closes,
      /** Report a turn end on the session the launch `line` started. */
      turnEnded: (line: string, reply: string) => watchers.get(sessionIn(line))!({ type: "turn-ended", reply }),
      run: () => saved!.runs["s"]!,
    };
  }
  /** Run the graph and let both roots start: a on terminal 1, b on terminal 2. */
  async function running(f: ReturnType<typeof graphFakes>): Promise<ScheduleRunner> {
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [graph], runs: {} });
    expect(await runner.run("s", all)).toEqual([]);
    await settle();
    f.launched[0]!.resolve({ terminalId: 1, processId: 10 });
    f.launched[1]!.resolve({ terminalId: 2, processId: 20 });
    await settle();
    return runner;
  }

  it("starts two siblings in separate worktrees together, both launched before either has started (AC-12, AC-13)", async () => {
    const f = graphFakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [graph], runs: {} });
    expect(await runner.run("s", all)).toEqual([]); // Slice 2's "worktree arrives in Slice 4" refusal is gone
    await settle();
    expect(f.worktrees).toEqual([
      { project: "/repo", scheduleId: "s", taskId: "a", reuse: false },
      { project: "/repo", scheduleId: "s", taskId: "b", reuse: false },
    ]);
    expect(f.launched.map((l) => l.cwd)).toEqual(["/wt/a", "/wt/b"]); // both in flight, neither resolved
    expect(f.launched[0]!.line).toContain(`cd '/wt/a'`);
    expect(f.run().tasks["a"]!.status).toBe("starting");
    expect(f.run().tasks["b"]!.status).toBe("starting");
  });

  it("runs a sameAs task in its upstream's real worktree and makes none of its own (AC-13, R20)", async () => {
    const f = graphFakes();
    await running(f);
    f.turnEnded(f.launched[0]!.line, "done");
    await settle();
    expect(f.launched[2]!.cwd).toBe("/wt/a");
    expect(f.launched[2]!.line).toContain(`'review /wt/a'`);
    expect(f.worktrees.map((w) => w.taskId)).toEqual(["a", "b"]);
  });

  it("retry reuses the task's worktree, closes the failed session and launches a new one (R13, R15)", async () => {
    const f = graphFakes();
    const runner = await running(f);
    f.exits.get(2)!();
    await settle();
    expect(f.run()).toMatchObject({ pausedBy: "failure", tasks: { b: { status: "failed" } } });
    expect(await runner.retry("s", "b", launch)).toEqual([]);
    await settle();
    expect(f.closes).toEqual([[2, 20]]);
    expect(f.worktrees[f.worktrees.length - 1]).toEqual({ project: "/repo", scheduleId: "s", taskId: "b", reuse: true });
    expect(f.launched[2]!.cwd).toBe("/wt/b");
    expect(f.run().tasks["b"]!.status).toBe("starting");
    expect(f.run().pausedBy).toBeUndefined();
  });

  it("skip lets the dependent start: it still shares the folder, but the placeholders arrive empty (AC-14)", async () => {
    const f = graphFakes();
    const runner = await running(f);
    f.exits.get(1)!();
    await settle();
    expect(await runner.skip("s", "a")).toEqual([]);
    await settle();
    expect(f.run().tasks["a"]!.status).toBe("skipped");
    expect(f.launched[2]!.cwd).toBe("/wt/a");
    expect(f.launched[2]!.line).toContain(`'review '`);
    expect(f.closes).toEqual([]); // R13: skip leaves the failed session open
  });

  it("fails a sameAs task whose upstream never got its worktree, instead of using the project folder (R20)", async () => {
    const f = graphFakes();
    f.ports.prepareWorktree = async (req) => {
      if (req.taskId === "a") throw new Error("/repo is not inside a git repository");
      return `/wt/${req.taskId}`;
    };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [graph], runs: {} });
    await runner.run("s", all);
    await settle();
    expect(f.run().tasks["a"]).toMatchObject({ status: "failed", error: "/repo is not inside a git repository" });
    await runner.skip("s", "a");
    await settle();
    expect(f.run().tasks["c"]).toMatchObject({ status: "failed", error: expect.stringContaining("never got its worktree") });
    expect(f.launched.map((l) => l.cwd)).toEqual(["/wt/b"]);
  });

  it("refuses retry and skip on a task that is not failed or interrupted, a bad launch, or a run that is over (R21)", async () => {
    const f = graphFakes();
    const runner = await running(f);
    const notFailed = [{ task: "a", field: "run", message: "Only a failed or interrupted task can be retried or skipped." }];
    expect(await runner.retry("s", "a", launch)).toEqual(notFailed);
    expect(await runner.skip("s", "a")).toEqual(notFailed);
    f.exits.get(1)!();
    await settle();
    const bad: TaskLaunch = { ...launch, plan: { ...launch.plan, command: "claude\nrm -rf ~" } };
    expect(await runner.retry("s", "a", bad)).toEqual([{ field: "run", message: "A task has no usable launch command." }]);
    await runner.abort("s");
    expect(await runner.skip("s", "a")).toEqual([{ field: "run", message: "This schedule is not running." }]);
    expect(f.launched).toHaveLength(2);
  });
});
