import { describe, expect, it } from "vitest";
import type { Schedule, TaskLaunch } from "../../common/schedule/schedule-types.js";
import { ScheduleRunner, type RunnerPorts } from "./schedule-runner.js";
import type { WatchEvent } from "./claude-task-watcher.js";
import type { ScheduleFile } from "./schedule-store.js";

const launch: TaskLaunch = { plan: { command: "claude", exportConfigDir: "", unquoted: true }, configDir: "" };
const schedule: Schedule = {
  id: "s",
  name: "S",
  tasks: [{ id: "a", name: "A", needs: [], project: "/repo", workspace: { kind: "folder" }, harness: "claude", prompt: "Go." }],
};

function fakes() {
  const lines: string[] = [];
  const names: [string, string][] = [];
  let watch: ((e: WatchEvent) => void) | undefined;
  let exit: (() => void) | undefined;
  let saved: ScheduleFile | undefined;
  const ports: RunnerPorts = {
    launch: async (line) => (lines.push(line), { terminalId: 3, processId: 30 }),
    onExit: (_id, l) => ((exit = l), () => (exit = undefined)),
    watchClaude: (_req, l) => ((watch = l), () => (watch = undefined)),
    watchOpencode: () => () => {},
    rename: async (id, name) => void names.push([id, name]),
    newSessionId: () => "u-1",
    now: () => 1,
    save: async (f) => void (saved = structuredClone(f)),
    publish: () => {},
  };
  return { ports, lines, names, emit: (e: WatchEvent) => watch!(e), exit: () => exit!(), saved: () => saved, watching: () => !!watch };
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
      return () => stopped.push(req.sessionId);
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
    f.ports.watchClaude = () => () => (watchStopped = true);
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
      return () => registrations.push(`unwatch:${req.sessionId}`);
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
});
