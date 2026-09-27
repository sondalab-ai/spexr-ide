import { describe, expect, it } from "vitest";
import type { RunState, Schedule } from "../../../common/schedule/schedule-types.js";
import { STATUS_VIEW, newSchedule, runBar, taskRows } from "./schedule-view.js";

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
});

describe("newSchedule", () => {
  it("picks an id not taken yet", () => {
    expect(newSchedule(new Set(["schedule-1"])).id).toBe("schedule-2");
  });
});
