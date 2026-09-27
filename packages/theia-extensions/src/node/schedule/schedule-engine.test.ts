import { describe, expect, it } from "vitest";
import type { RunState, Schedule, ScheduleTask, TaskLaunch } from "../../common/schedule/schedule-types.js";
import { firstPrompt, followUpPrompt } from "../../common/schedule/schedule-prompt.js";
import { startRun, step } from "./schedule-engine.js";

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

    it("resume without a pause changes nothing", () => {
      const run = started();
      expect(step(s, run, { type: "resume" })).toEqual({ run, effects: [] });
    });
  });
});
