import { describe, expect, it } from "vitest";
import type { Schedule, ScheduleTask, TaskLaunch } from "../../common/schedule/schedule-types.js";
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
