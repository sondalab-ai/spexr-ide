import { describe, expect, it } from "vitest";
import type { RunState, Schedule } from "../../../common/schedule/schedule-types.js";
import {
  STATUS_VIEW,
  bandsOf,
  duplicateSchedule,
  newSchedule,
  pendingKey,
  runBar,
  taskRows,
  taskTransitions,
  upstreamHighlight,
  withPending,
} from "./schedule-view.js";

const s: Schedule = {
  id: "s",
  name: "S",
  tasks: [
    { id: "a", name: "A", needs: [], project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p", permissionMode: "bypassPermissions" },
    { id: "b", name: "B", needs: ["a"], project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p", loop: { stopCriteria: "s", followUp: "f", maxIterations: 5 } },
  ],
};
const run = (a: string, b: string, o: Partial<RunState> = {}): RunState => ({
  scheduleId: "s", runId: "r", status: "running", startedAtMs: 0, launches: {},
  tasks: { a: { status: a as never, iteration: 1 }, b: { status: b as never, iteration: 2 } }, ...o,
});

describe("STATUS_VIEW", () => {
  it("gives every status a label and an icon, never colour alone", () => {
    for (const v of Object.values(STATUS_VIEW)) {
      expect(v.label).toBeTruthy();
      expect(v.icon).toMatch(/^codicon-/);
    }
  });
});

describe("taskRows", () => {
  it("lays tasks out by layer with what they wait for", () => {
    const rows = taskRows(s);
    expect(rows.map((r) => [r.id, r.layer, r.waitsFor])).toEqual([["a", 0, []], ["b", 1, ["A"]]]);
    expect(rows[0]!.status).toBe("pending");
  });
  it("shows run state, iteration and the unattended warning", () => {
    const rows = taskRows(s, run("converged", "running"));
    expect(rows[0]!.label).toBe(STATUS_VIEW.converged.label);
    expect(rows[0]!.unattended).toBe(true);
    expect(rows[1]!.iteration).toBe("2 / 5");
  });
  it("falls back to a flat list at layer 0 on a cyclic schedule, instead of hanging", () => {
    const cyclic: Schedule = {
      id: "c",
      name: "C",
      tasks: [
        { id: "a", name: "A", needs: ["b"], project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p" },
        { id: "b", name: "B", needs: ["a"], project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p" },
      ],
    };
    const rows = taskRows(cyclic);
    expect(rows.map((r) => [r.id, r.layer])).toEqual([["a", 0], ["b", 0]]);
  });
});

describe("taskTransitions", () => {
  it("announces nothing on the first render", () => {
    expect(taskTransitions(undefined, taskRows(s))).toEqual([]);
  });
  it("announces nothing when no status changed", () => {
    const rows = taskRows(s, run("running", "pending"));
    expect(taskTransitions(rows, taskRows(s, run("running", "pending")))).toEqual([]);
  });
  it("announces every task whose status changed, in row order", () => {
    const before = taskRows(s, run("running", "pending"));
    const after = taskRows(s, run("converged", "running"));
    expect(taskTransitions(before, after)).toEqual([
      `A: ${STATUS_VIEW.converged.label}`,
      `B: ${STATUS_VIEW.running.label}`,
    ]);
  });
});

describe("runBar", () => {
  it("offers Run for a valid idle schedule and lists the problems otherwise", () => {
    expect(runBar(s, undefined, [])).toMatchObject({ canRun: true, canAbort: false });
    const bad = runBar(s, undefined, [{ task: "a", field: "prompt", message: "Write the prompt." }]);
    expect(bad.canRun).toBe(false);
    expect(bad.reasons).toEqual(["A: Write the prompt."]);
  });
  it("offers Abort while running, and Run again after the run ended", () => {
    expect(runBar(s, run("running", "pending"), [])).toMatchObject({ canRun: false, canAbort: true });
    expect(runBar(s, run("converged", "converged", { status: "finished" }), [])).toMatchObject({ canRun: true, canAbort: false });
  });
  it("lists a schedule-level (backend) refusal by its message alone, with no task to name", () => {
    const refused = runBar(s, undefined, [{ field: "run", message: "A task has no usable launch command." }]);
    expect(refused.canRun).toBe(false);
    expect(refused.reasons).toEqual(["A task has no usable launch command."]);
  });
  it("offers Pause while running, Resume only after an operator pause, and names a failure pause", () => {
    expect(runBar(s, run("running", "pending"), [])).toMatchObject({ canPause: true, canResume: false, label: "Running" });
    expect(runBar(s, run("running", "held", { pausedBy: "operator" }), [])).toMatchObject({
      canPause: false,
      canResume: true,
      label: "Paused",
    });
    expect(runBar(s, run("failed", "running", { pausedBy: "failure" }), [])).toMatchObject({
      canPause: true,
      canResume: false,
      label: "Paused on a failure",
    });
    expect(runBar(s, undefined, [])).toMatchObject({ canPause: false, canResume: false });
  });
});

describe("newSchedule", () => {
  it("picks an id not taken yet", () => {
    expect(newSchedule(new Set(["schedule-1"])).id).toBe("schedule-2");
  });
});

describe("rows for the graph (Slice 4)", () => {
  const g: Schedule = {
    id: "g",
    name: "G",
    tasks: [
      { id: "a", name: "A", needs: [], project: "/r", workspace: { kind: "worktree" }, harness: "claude", prompt: "p" },
      { id: "b", name: "B", needs: ["a"], project: "/r", workspace: { kind: "sameAs", task: "a" }, harness: "opencode", prompt: "p" },
      { id: "c", name: "C", needs: [], project: "/q", workspace: { kind: "folder" }, harness: "claude", prompt: "p" },
    ],
  };
  const runOf = (tasks: RunState["tasks"], status: RunState["status"] = "running"): RunState => ({
    scheduleId: "g", runId: "r", status, startedAtMs: 0, launches: {}, tasks,
  });

  it("names each row's workspace", () => {
    expect(taskRows(g).map((r) => [r.id, r.workspace])).toEqual([["a", "Worktree"], ["c", "Project folder"], ["b", "Same as A"]]);
  });
  it("offers Retry and Skip only on a failed or interrupted task of a running run (R21)", () => {
    const tasks: RunState["tasks"] = {
      a: { status: "failed", iteration: 1 },
      b: { status: "pending", iteration: 0 },
      c: { status: "interrupted", iteration: 1 },
    };
    expect(taskRows(g, runOf(tasks)).map((r) => [r.id, r.canRetry])).toEqual([["a", true], ["c", true], ["b", false]]);
    expect(taskRows(g, runOf(tasks, "aborted")).some((r) => r.canRetry)).toBe(false);
  });
  it("shows the opencode session the runner adopted (spec, Risks)", () => {
    const rows = taskRows(g, runOf({
      a: { status: "converged", iteration: 1, sessionId: "u-a" },
      b: { status: "running", iteration: 1, sessionId: "ses_42" },
      c: { status: "pending", iteration: 0 },
    }));
    expect(rows.find((r) => r.id === "b")!.session).toBe("ses_42");
    expect("session" in rows.find((r) => r.id === "a")!).toBe(false);
  });
  it("groups rows into layer bands", () => {
    expect(bandsOf(taskRows(g)).map((b) => [b.layer, b.rows.map((r) => r.id)])).toEqual([[0, ["a", "c"]], [1, ["b"]]]);
  });
  it("highlights every task upstream of the selection, and nothing without one", () => {
    expect([...upstreamHighlight(g, "b")]).toEqual(["a"]);
    expect(upstreamHighlight(g, undefined).size).toBe(0);
  });
  it("duplicates a schedule under a free id, as a deep copy", () => {
    const copy = duplicateSchedule(g, new Set(["g", "schedule-1"]));
    expect(copy).toMatchObject({ id: "schedule-2", name: "G (copy)" });
    expect(copy.tasks).toEqual(g.tasks);
    expect(copy.tasks[0]).not.toBe(g.tasks[0]);
  });
});

describe("pendingKey and withPending", () => {
  it("keys a task by its schedule, so a duplicate's same-named task is a different key", () => {
    expect(pendingKey("g", "a")).not.toBe(pendingKey("schedule-2", "a"));
  });
  it("adds and drops a key without mutating the set handed in", () => {
    const empty = new Set<string>();
    const added = withPending(empty, pendingKey("g", "a"), true);
    expect(empty.size).toBe(0);
    expect(added.has(pendingKey("g", "a"))).toBe(true);
    const removed = withPending(added, pendingKey("g", "a"), false);
    expect(added.has(pendingKey("g", "a"))).toBe(true);
    expect(removed.size).toBe(0);
  });
});
