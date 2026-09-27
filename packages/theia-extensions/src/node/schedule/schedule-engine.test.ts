import { describe, expect, it } from "vitest";
import type { RunState, Schedule, ScheduleTask, TaskLaunch } from "../../common/schedule/schedule-types.js";
import { firstPrompt, followUpPrompt } from "../../common/schedule/schedule-prompt.js";
import { startRun, step, workspacePlan } from "./schedule-engine.js";

const launch: TaskLaunch = { plan: { command: "claude", exportConfigDir: "", unquoted: true }, configDir: "" };
function task(id: string, o: Partial<ScheduleTask> = {}): ScheduleTask {
  return { id, name: id.toUpperCase(), needs: [], project: `/r-${id}`, workspace: { kind: "folder" }, harness: "claude", prompt: `do ${id}`, ...o };
}
const sched = (...tasks: ScheduleTask[]): Schedule => ({ id: "s", name: "Nightly", tasks });
const launches = (s: Schedule) => Object.fromEntries(s.tasks.map((t) => [t.id, launch]));

describe("startRun", () => {
  it("starts every task with no needs, and only those", () => {
    const s = sched(task("a"), task("b"), task("c", { needs: ["a"] }));
    const { run, effects } = startRun(s, launches(s), "r1", 0);
    expect(effects).toEqual([
      { type: "start", task: "a", prompt: "do a" },
      { type: "start", task: "b", prompt: "do b" },
    ]);
    expect(run.tasks["c"]!.status).toBe("pending");
    expect(run.tasks["a"]!.status).toBe("starting");
  });
});

describe("step", () => {
  const s = sched(task("a"), task("c", { needs: ["a"], prompt: "after: {{a.reply}} in {{a.workspace}}" }));
  const first = () => startRun(s, launches(s), "r1", 0).run;
  const started = () =>
    step(s, first(), { type: "started", task: "a", terminalId: 7, processId: 70, workspace: "/r-a" }).run;

  it("records the session id a Claude task was launched with", () => {
    const run = step(s, first(), { type: "started", task: "a", terminalId: 7, processId: 70, workspace: "/r-a", sessionId: "u0" }).run;
    expect(run.tasks["a"]!.sessionId).toBe("u0");
  });

  it("records the terminal and names the session once it is found", () => {
    const run = started();
    expect(run.tasks["a"]).toMatchObject({ status: "running", terminalId: 7, processId: 70, workspace: "/r-a" });
    const found = step(s, run, { type: "session-found", task: "a", sessionId: "u1" });
    expect(found.run.tasks["a"]!.sessionId).toBe("u1");
    expect(found.effects).toEqual([{ type: "name", sessionId: "u1", name: "Nightly · A (1/1)" }]);
  });

  it("converges on a turn end and starts the dependent with the hand-off filled in", () => {
    const { run, effects } = step(s, started(), { type: "turn-ended", task: "a", reply: "shipped\nCONVERGED" });
    expect(run.tasks["a"]).toMatchObject({ status: "converged", reply: "shipped\nCONVERGED" });
    expect(effects).toEqual([{ type: "start", task: "c", prompt: "after: shipped in /r-a" }]);
  });

  it("finishes the run when every task has converged", () => {
    let run = step(s, started(), { type: "turn-ended", task: "a", reply: "x" }).run;
    run = step(s, run, { type: "started", task: "c", terminalId: 8, processId: 80, workspace: "/r-c" }).run;
    run = step(s, run, { type: "turn-ended", task: "c", reply: "y" }).run;
    expect(run.status).toBe("finished");
  });

  it("marks waiting-on-you and back", () => {
    const waiting = step(s, started(), { type: "needs-you", task: "a" }).run;
    expect(waiting.tasks["a"]!.status).toBe("waiting-on-you");
    expect(step(s, waiting, { type: "resumed-working", task: "a" }).run.tasks["a"]!.status).toBe("running");
  });

  it("fails the task and pauses the run when the session is missing, exits, or cannot start", () => {
    for (const event of [
      { type: "session-missing", task: "a" } as const,
      { type: "exited", task: "a" } as const,
    ]) {
      const { run, effects } = step(s, started(), event);
      expect(run.tasks["a"]!.status).toBe("failed");
      expect(run.tasks["a"]!.error).toBeTruthy();
      expect(run.pausedBy).toBe("failure");
      expect(effects).toEqual([]);
    }
    const failed = step(s, first(), { type: "start-failed", task: "a", error: "no shell" }).run;
    expect(failed.tasks["a"]).toMatchObject({ status: "failed", error: "no shell" });
  });

  it("ignores an exit after convergence", () => {
    const done = step(s, started(), { type: "turn-ended", task: "a", reply: "x" }).run;
    expect(step(s, done, { type: "exited", task: "a" }).run.tasks["a"]!.status).toBe("converged");
  });

  it("abort ends the run and starts nothing more", () => {
    const aborted = step(s, started(), { type: "abort" });
    expect(aborted.run.status).toBe("aborted");
    const after = step(s, aborted.run, { type: "turn-ended", task: "a", reply: "x" });
    expect(after.effects).toEqual([]);
  });

  it("recover marks active tasks interrupted and pauses the run (AC-16)", () => {
    const { run } = step(s, started(), { type: "recover" });
    expect(run.tasks["a"]!.status).toBe("interrupted");
    expect(run.pausedBy).toBe("failure");
  });

  it("never mutates the run it is given", () => {
    const run = started();
    const copy = structuredClone(run);
    step(s, run, { type: "turn-ended", task: "a", reply: "x" });
    expect(run).toEqual(copy);
  });
});

describe("step — loop until converged (Slice 3)", () => {
  const loop = { stopCriteria: "tests pass", followUp: "Keep going.", maxIterations: 3 };
  const s = sched(
    task("a", { loop: { ...loop, check: "pnpm test" } }),
    task("b", { loop: { ...loop, maxIterations: 2 } }),
    task("c", { needs: ["a"] }),
  );
  const [A, B] = s.tasks as [ScheduleTask, ScheduleTask, ScheduleTask];
  const started = (): RunState => {
    let run = startRun(s, launches(s), "r1", 0).run;
    run = step(s, run, { type: "started", task: "a", terminalId: 7, processId: 70, workspace: "/r-a", sessionId: "ua" }).run;
    return step(s, run, { type: "started", task: "b", terminalId: 8, processId: 80, workspace: "/r-b", sessionId: "ub" }).run;
  };
  const checking = (): RunState => step(s, started(), { type: "turn-ended", task: "a", reply: "done\nCONVERGED" }).run;

  it("starts a looping task with the stop criteria and the marker instruction (AC-9)", () => {
    const { effects } = startRun(s, launches(s), "r1", 0);
    expect(effects[0]).toEqual({ type: "start", task: "a", prompt: firstPrompt(A, "do a") });
    expect((effects[0] as { prompt: string }).prompt).toContain("tests pass");
    expect((effects[0] as { prompt: string }).prompt).toContain("CONVERGED");
  });

  it("a reply without the marker renames the session and pastes the follow-up (AC-9)", () => {
    const { run, effects } = step(s, started(), { type: "turn-ended", task: "b", reply: "working on it" });
    expect(run.tasks["b"]).toMatchObject({ status: "running", iteration: 2, reply: "working on it" });
    expect(effects).toEqual([
      { type: "name", sessionId: "ub", name: "Nightly · B (2/2)" },
      { type: "paste", task: "b", terminalId: 8, text: followUpPrompt(B) },
    ]);
  });

  it("the marker runs the check in the workspace, verbatim (AC-10)", () => {
    const { run, effects } = step(s, started(), { type: "turn-ended", task: "a", reply: "done\nCONVERGED" });
    expect(run.tasks["a"]!.status).toBe("checking");
    expect(effects).toEqual([{ type: "check", task: "a", command: "pnpm test", cwd: "/r-a", timeoutSec: 600 }]);
  });

  it("never fills a placeholder into a check command, whatever an upstream reply holds (Security)", () => {
    const h = sched(task("u"), task("d", { needs: ["u"], loop: { ...loop, check: "pnpm test -- {{u.reply}}" } }));
    let run = startRun(h, launches(h), "r", 0).run;
    run = step(h, run, { type: "started", task: "u", terminalId: 1, processId: 10, workspace: "/r-u" }).run;
    run = step(h, run, { type: "turn-ended", task: "u", reply: "$(touch /tmp/pwned)" }).run;
    run = step(h, run, { type: "started", task: "d", terminalId: 2, processId: 20, workspace: "/r-d" }).run;
    const { effects } = step(h, run, { type: "turn-ended", task: "d", reply: "ok\nCONVERGED" });
    expect(effects).toEqual([{ type: "check", task: "d", command: "pnpm test -- {{u.reply}}", cwd: "/r-d", timeoutSec: 600 }]);
    expect(JSON.stringify(effects)).not.toContain("pwned");
  });

  it("the marker converges at once when there is no check", () => {
    expect(step(s, started(), { type: "turn-ended", task: "b", reply: "CONVERGED" }).run.tasks["b"]!.status).toBe("converged");
  });

  it("a passing check converges the task and starts its dependent (AC-10)", () => {
    const { run, effects } = step(s, checking(), { type: "check-done", task: "a", ok: true, tail: "" });
    expect(run.tasks["a"]!.status).toBe("converged");
    expect(effects).toEqual([{ type: "start", task: "c", prompt: "do c" }]);
  });

  it("a failing check goes round again, the follow-up carrying the command's output (AC-10)", () => {
    const { run, effects } = step(s, checking(), { type: "check-done", task: "a", ok: false, tail: "FAIL src/x.test.ts" });
    expect(run.tasks["a"]).toMatchObject({ status: "running", iteration: 2 });
    const paste = effects.find((e) => e.type === "paste") as { text: string };
    expect(paste.text).toBe(followUpPrompt(A, { command: "pnpm test", tail: "FAIL src/x.test.ts" }));
    expect(paste.text).toContain("FAIL src/x.test.ts");
    expect(effects[0]).toEqual({ type: "name", sessionId: "ua", name: "Nightly · A (2/3)" });
  });

  it("reaching maxIterations without converging fails the task and pauses the run (AC-11)", () => {
    let run = step(s, started(), { type: "turn-ended", task: "b", reply: "not yet" }).run;
    const last = step(s, run, { type: "turn-ended", task: "b", reply: "still not" });
    run = last.run;
    expect(run.tasks["b"]!.status).toBe("failed");
    expect(run.tasks["b"]!.error).toMatch(/2 iterations/);
    expect(run.pausedBy).toBe("failure");
    expect(last.effects).toEqual([]);
  });

  it("ignores a check result for a task that is not checking", () => {
    const run = started();
    expect(step(s, run, { type: "check-done", task: "a", ok: true, tail: "" }).run.tasks["a"]!.status).toBe("running");
  });

  it("an exit while checking fails the task", () => {
    expect(step(s, checking(), { type: "exited", task: "a" }).run.tasks["a"]!.status).toBe("failed");
  });

  it("a failure pause does not stop a running looping task from pasting its follow-up on a non-converged turn end", () => {
    const failed = step(s, started(), { type: "exited", task: "b" }).run;
    expect(failed.pausedBy).toBe("failure");
    const { run, effects } = step(s, failed, { type: "turn-ended", task: "a", reply: "still going" });
    expect(run.tasks["a"]).toMatchObject({ status: "running", iteration: 2 });
    expect(effects.some((e) => e.type === "paste")).toBe(true);
  });

  it("check-done ok:false at the last iteration fails the task and pauses the run (AC-11)", () => {
    let run = step(s, started(), { type: "turn-ended", task: "a", reply: "not yet 1" }).run; // iteration 1 -> 2
    run = step(s, run, { type: "turn-ended", task: "a", reply: "not yet 2" }).run; // iteration 2 -> 3 (== maxIterations)
    run = step(s, run, { type: "turn-ended", task: "a", reply: "done\nCONVERGED" }).run; // -> checking
    expect(run.tasks["a"]!.status).toBe("checking");
    const { run: failed, effects } = step(s, run, { type: "check-done", task: "a", ok: false, tail: "still red" });
    expect(failed.tasks["a"]!.status).toBe("failed");
    expect(failed.tasks["a"]!.error).toMatch(/3 iterations: the check still fails/);
    expect(failed.pausedBy).toBe("failure");
    expect(effects).toEqual([]);
  });

  describe("operator pause (R3, R4)", () => {
    const paused = (): RunState => step(s, started(), { type: "pause" }).run;

    it("holds a turn end, then replays it on resume", () => {
      const held = step(s, paused(), { type: "turn-ended", task: "b", reply: "not yet" });
      expect(held.run.tasks["b"]).toMatchObject({ status: "held", reply: "not yet", iteration: 1 });
      expect(held.effects).toEqual([]);
      const resumed = step(s, held.run, { type: "resume" });
      expect(resumed.run.pausedBy).toBeUndefined();
      expect(resumed.run.tasks["b"]).toMatchObject({ status: "running", iteration: 2 });
      expect(resumed.effects).toContainEqual({ type: "paste", task: "b", terminalId: 8, text: followUpPrompt(B) });
    });

    it("holds a marker turn end without running the check, and starts no dependent until resume", () => {
      const held = step(s, paused(), { type: "turn-ended", task: "a", reply: "done\nCONVERGED" });
      expect(held.run.tasks["a"]!.status).toBe("held");
      expect(held.effects).toEqual([]);
      const resumed = step(s, held.run, { type: "resume" });
      expect(resumed.effects).toEqual([{ type: "check", task: "a", command: "pnpm test", cwd: "/r-a", timeoutSec: 600 }]);
      const done = step(s, resumed.run, { type: "check-done", task: "a", ok: true, tail: "" });
      expect(done.effects).toEqual([{ type: "start", task: "c", prompt: "do c" }]);
    });

    it("lets a running check converge the task, but holds a failing one with its output", () => {
      let run = step(s, checking(), { type: "pause" }).run;
      const failed = step(s, run, { type: "check-done", task: "a", ok: false, tail: "boom" });
      expect(failed.run.tasks["a"]).toMatchObject({ status: "held", checkTail: "boom" });
      expect(failed.effects).toEqual([]);
      const resumed = step(s, failed.run, { type: "resume" });
      const paste = resumed.effects.find((e) => e.type === "paste") as { text: string };
      expect(paste.text).toContain("boom");
      expect(resumed.run.tasks["a"]!.checkTail).toBeUndefined();

      run = step(s, checking(), { type: "pause" }).run;
      const passed = step(s, run, { type: "check-done", task: "a", ok: true, tail: "" });
      expect(passed.run.tasks["a"]!.status).toBe("converged");
      expect(passed.effects).toEqual([]); // paused: c does not start yet
    });

    it("a newer turn end on a held task replaces the held reply", () => {
      let run = step(s, paused(), { type: "turn-ended", task: "b", reply: "not yet" }).run;
      run = step(s, run, { type: "turn-ended", task: "b", reply: "done\nCONVERGED" }).run;
      const resumed = step(s, run, { type: "resume" });
      expect(resumed.run.tasks["b"]!.status).toBe("converged");
      expect(resumed.effects).toEqual([]);
    });

    it("survives a failure: resume falls back to the failure pause and still replays held turns", () => {
      let run = step(s, paused(), { type: "turn-ended", task: "b", reply: "not yet" }).run;
      run = step(s, run, { type: "exited", task: "a" }).run;
      expect(run.pausedBy).toBe("operator");
      const resumed = step(s, run, { type: "resume" });
      expect(resumed.run.pausedBy).toBe("failure");
      expect(resumed.effects).toContainEqual({ type: "paste", task: "b", terminalId: 8, text: followUpPrompt(B) });
    });

    it("pausing over a failure pause and resuming keeps the failure pause", () => {
      let run = step(s, started(), { type: "exited", task: "b" }).run;
      run = step(s, run, { type: "pause" }).run;
      expect(run.pausedBy).toBe("operator");
      expect(step(s, run, { type: "resume" }).run.pausedBy).toBe("failure");
    });

    it("recover after an operator pause keeps the operator pause; resume then falls back to failure (regression)", () => {
      let run = step(s, started(), { type: "pause" }).run;
      run = step(s, run, { type: "recover" }).run;
      expect(run.tasks["a"]!.status).toBe("interrupted");
      expect(run.tasks["b"]!.status).toBe("interrupted");
      expect(run.pausedBy).toBe("operator");
      const resumed = step(s, run, { type: "resume" });
      expect(resumed.run.pausedBy).toBe("failure");
      expect(resumed.effects).toEqual([]);
    });

    it("a resume replay that runs out of iterations fails the task, pauses on the failure, and starts no dependent", () => {
      let run = started();
      run = step(s, run, { type: "turn-ended", task: "a", reply: "not yet 1" }).run; // iteration 1 -> 2
      run = step(s, run, { type: "turn-ended", task: "a", reply: "not yet 2" }).run; // iteration 2 -> 3 (== maxIterations)
      run = step(s, run, { type: "pause" }).run;
      const held = step(s, run, { type: "turn-ended", task: "a", reply: "still not there" }).run;
      expect(held.tasks["a"]).toMatchObject({ status: "held", iteration: 3 });
      const resumed = step(s, held, { type: "resume" });
      expect(resumed.run.tasks["a"]!.status).toBe("failed");
      expect(resumed.run.tasks["a"]!.error).toMatch(/3 iterations/);
      expect(resumed.run.pausedBy).toBe("failure");
      expect(resumed.effects.some((e) => e.type === "start")).toBe(false);
    });

    it("resume without a pause changes nothing", () => {
      const run = started();
      expect(step(s, run, { type: "resume" })).toEqual({ run, effects: [] });
    });
  });
});

describe("step — retry and skip (Slice 4)", () => {
  const s = sched(task("a"), task("b"), task("c", { needs: ["a"], prompt: "after {{a.reply}} in [{{a.workspace}}]" }));
  const other: TaskLaunch = { plan: { command: "claude-work", exportConfigDir: "", unquoted: true }, configDir: "/acct" };
  const begin = (): RunState => {
    let run = startRun(s, launches(s), "r1", 0).run;
    run = step(s, run, { type: "started", task: "a", terminalId: 7, processId: 70, workspace: "/r-a", sessionId: "u-a" }).run;
    return step(s, run, { type: "started", task: "b", terminalId: 8, processId: 80, workspace: "/r-b", sessionId: "u-b" }).run;
  };
  const failed = (run: RunState, id: string): RunState => step(s, run, { type: "exited", task: id }).run;

  it("retry starts the task again from iteration 1 in a bare state, closes the failed session, and takes the new launch (R12, R13, R22)", () => {
    const { run, effects } = step(s, failed(begin(), "a"), { type: "retry", task: "a", launch: other });
    expect(run.tasks["a"]).toEqual({ status: "starting", iteration: 1 });
    expect(run.launches["a"]).toEqual(other);
    expect(effects).toEqual([
      { type: "close", terminalId: 7, processId: 70 },
      { type: "start", task: "a", prompt: "do a", reuse: true },
    ]);
    expect(run.pausedBy).toBeUndefined();
  });

  it("retry of an interrupted task never closes a terminal: its id may belong to another process now (R13)", () => {
    const recovered = step(s, begin(), { type: "recover" }).run;
    const { run, effects } = step(s, recovered, { type: "retry", task: "a", launch });
    expect(effects).toEqual([{ type: "start", task: "a", prompt: "do a", reuse: true }]);
    expect(run.tasks["a"]!.status).toBe("starting");
    expect(run.pausedBy).toBe("failure"); // b is still interrupted
  });

  it("a failure pause clears only when nothing else is failed or interrupted", () => {
    let run = failed(failed(begin(), "a"), "b");
    run = step(s, run, { type: "retry", task: "a", launch }).run;
    expect(run.pausedBy).toBe("failure");
    run = step(s, run, { type: "skip", task: "b" }).run;
    expect(run.pausedBy).toBeUndefined();
  });

  it("skip lets dependents start, and the skipped task's placeholders render empty even when it replied (AC-14)", () => {
    const s2 = sched(
      task("a", { loop: { stopCriteria: "done", followUp: "more", maxIterations: 1 } }),
      task("c", { needs: ["a"], prompt: "after {{a.reply}} in [{{a.workspace}}]" }),
    );
    let run = startRun(s2, launches(s2), "r1", 0).run;
    run = step(s2, run, { type: "started", task: "a", terminalId: 7, processId: 70, workspace: "/r-a" }).run;
    run = step(s2, run, { type: "turn-ended", task: "a", reply: "half of it" }).run;
    expect(run.tasks["a"]).toMatchObject({ status: "failed", reply: "half of it" });
    const out = step(s2, run, { type: "skip", task: "a" });
    expect(out.run.tasks["a"]!.status).toBe("skipped");
    expect(out.run.pausedBy).toBeUndefined();
    expect(out.effects).toEqual([{ type: "start", task: "c", prompt: "after  in []" }]); // no close: R13
  });

  it("a run finishes once every task has converged or been skipped", () => {
    const s3 = sched(task("a"), task("b"));
    let run = startRun(s3, launches(s3), "r1", 0).run;
    run = step(s3, run, { type: "started", task: "a", terminalId: 7, processId: 70, workspace: "/r-a" }).run;
    run = step(s3, run, { type: "started", task: "b", terminalId: 8, processId: 80, workspace: "/r-b" }).run;
    run = step(s3, run, { type: "turn-ended", task: "a", reply: "ok" }).run;
    run = step(s3, run, { type: "exited", task: "b" }).run;
    expect(run.status).toBe("running");
    expect(step(s3, run, { type: "skip", task: "b" }).run.status).toBe("finished");
  });

  it("an operator pause survives retry and skip; a retried task starts at once and its turn end is held (R11, R4)", () => {
    const paused = step(s, failed(begin(), "a"), { type: "pause" }).run;
    const retried = step(s, paused, { type: "retry", task: "a", launch });
    expect(retried.run.pausedBy).toBe("operator");
    expect(retried.effects.map((e) => e.type)).toEqual(["close", "start"]);
    let run = step(s, retried.run, { type: "started", task: "a", terminalId: 9, processId: 90, workspace: "/r-a" }).run;
    run = step(s, run, { type: "turn-ended", task: "a", reply: "done" }).run;
    expect(run.tasks["a"]!.status).toBe("held");
    expect(run.tasks["c"]!.status).toBe("pending");
    const skipped = step(s, failed(run, "b"), { type: "skip", task: "b" });
    expect(skipped.run.pausedBy).toBe("operator");
    expect(skipped.effects).toEqual([]);
    const resumed = step(s, skipped.run, { type: "resume" });
    expect(resumed.run.pausedBy).toBeUndefined();
    expect(resumed.effects).toEqual([{ type: "start", task: "c", prompt: "after done in [/r-a]" }]);
  });

  it("retry and skip ignore a task that is not failed or interrupted", () => {
    const run = begin();
    for (const e of [
      { type: "retry", task: "a", launch } as const,
      { type: "skip", task: "a" } as const,
      { type: "skip", task: "c" } as const,
    ]) {
      const out = step(s, run, e);
      expect(out.run).toEqual(run);
      expect(out.effects).toEqual([]);
    }
  });
});

describe("step — the graph (Slice 4)", () => {
  const d = sched(
    task("a"),
    task("b", { needs: ["a"] }),
    task("c", { needs: ["a"], workspace: { kind: "worktree" } }),
    task("d", { needs: ["b", "c"], prompt: "b said {{b.reply}}; c worked in {{c.workspace}}" }),
  );
  const started = (id: string, n: number, workspace: string) =>
    ({ type: "started", task: id, terminalId: n, processId: n * 10, workspace }) as const;

  it("starts every ready task at once, and a task only once all its needs have converged (AC-12, AC-14)", () => {
    const first = startRun(d, launches(d), "r1", 0);
    expect(first.effects).toEqual([{ type: "start", task: "a", prompt: "do a" }]);
    const afterA = step(d, step(d, first.run, started("a", 1, "/r-a")).run, { type: "turn-ended", task: "a", reply: "base ready" });
    expect(afterA.effects).toEqual([
      { type: "start", task: "b", prompt: "do b" },
      { type: "start", task: "c", prompt: "do c" },
    ]);
    let run = step(d, afterA.run, started("b", 2, "/r-b")).run;
    run = step(d, run, started("c", 3, "/wt/c")).run;
    const afterB = step(d, run, { type: "turn-ended", task: "b", reply: "api done\nCONVERGED" });
    expect(afterB.effects).toEqual([]);
    expect(afterB.run.tasks["d"]!.status).toBe("pending");
    const afterC = step(d, afterB.run, { type: "turn-ended", task: "c", reply: "client done" });
    expect(afterC.effects).toEqual([{ type: "start", task: "d", prompt: "b said api done; c worked in /wt/c" }]);
  });

  it("lets running siblings finish during a failure pause, and starts the join only once the failure is skipped (AC-15)", () => {
    let run = startRun(d, launches(d), "r1", 0).run;
    run = step(d, run, started("a", 1, "/r-a")).run;
    run = step(d, run, { type: "turn-ended", task: "a", reply: "ok" }).run;
    run = step(d, run, started("b", 2, "/r-b")).run;
    run = step(d, run, started("c", 3, "/wt/c")).run;
    run = step(d, run, { type: "exited", task: "b" }).run;
    expect(run.pausedBy).toBe("failure");
    const cDone = step(d, run, { type: "turn-ended", task: "c", reply: "client done" });
    expect(cDone.run.tasks["c"]!.status).toBe("converged");
    expect(cDone.effects).toEqual([]);
    const skipped = step(d, cDone.run, { type: "skip", task: "b" });
    expect(skipped.effects).toEqual([{ type: "start", task: "d", prompt: "b said ; c worked in /wt/c" }]);
  });
});

describe("workspacePlan (R20)", () => {
  const w = sched(
    task("a", { workspace: { kind: "worktree" } }),
    task("f", { project: "/r-f" }),
    task("b", { needs: ["a"], workspace: { kind: "sameAs", task: "a" } }),
    task("c", { needs: ["b"], workspace: { kind: "sameAs", task: "b" } }),
    task("g", { needs: ["f"], workspace: { kind: "sameAs", task: "f" } }),
  );
  const fresh = () => startRun(w, launches(w), "r1", 0).run;

  it("gives a folder task its project and a worktree task a worktree to prepare", () => {
    expect(workspacePlan(w, fresh(), "f")).toEqual({ kind: "path", path: "/r-f" });
    expect(workspacePlan(w, fresh(), "a")).toEqual({ kind: "worktree" });
  });
  it("runs a sameAs task in the folder its upstream actually used, through a chain", () => {
    const run = step(w, fresh(), { type: "started", task: "a", terminalId: 1, processId: 10, workspace: "/wt/app-spexr-s-a" }).run;
    expect(workspacePlan(w, run, "b")).toEqual({ kind: "path", path: "/wt/app-spexr-s-a" });
    expect(workspacePlan(w, run, "c")).toEqual({ kind: "path", path: "/wt/app-spexr-s-a" });
  });
  it("uses a folder upstream's project even before it ran, but never falls back to the project for a worktree nobody made", () => {
    expect(workspacePlan(w, fresh(), "g")).toEqual({ kind: "path", path: "/r-f" });
    expect(workspacePlan(w, fresh(), "b")).toEqual({ kind: "missing", reason: expect.stringContaining("never got its worktree") });
  });
});
