import { describe, expect, it } from "vitest";
import type { ScheduleSnapshot } from "../../../common/schedule/schedule-protocol.js";
import { taskCardsToMount } from "./schedule-wall.js";

const snapshot = (status: string, runStatus = "running"): ScheduleSnapshot => ({
  schedules: [{ id: "s", name: "S", tasks: [{ id: "a", name: "A", needs: [], project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p" }] }],
  runs: {
    s: {
      scheduleId: "s", runId: "r", status: runStatus as never, startedAtMs: 0, launches: {},
      tasks: { a: { status: status as never, iteration: 1, terminalId: 4, processId: 40, workspace: "/r", sessionId: "u" } },
    },
  },
});

describe("taskCardsToMount", () => {
  it("mounts an active task's terminal once", () => {
    expect(taskCardsToMount(snapshot("running"), new Set())).toEqual([
      { key: "spexr-task-4", terminalId: 4, processId: 40, workspace: "/r", harness: "claude", sessionId: "u" },
    ]);
    expect(taskCardsToMount(snapshot("running"), new Set(["spexr-task-4"]))).toEqual([]);
  });
  it("skips a task whose session the wall already shows (pinned after a reload)", () => {
    expect(taskCardsToMount(snapshot("running"), new Set(["u"]))).toEqual([]);
  });
  it("skips settled tasks, tasks without a terminal yet, and ended runs", () => {
    expect(taskCardsToMount(snapshot("converged"), new Set())).toEqual([]);
    expect(taskCardsToMount(snapshot("starting"), new Set())).toHaveLength(1);
    expect(taskCardsToMount(snapshot("running", "aborted"), new Set())).toEqual([]);
    const noTerminal = snapshot("starting");
    delete noTerminal.runs["s"]!.tasks["a"]!.terminalId;
    expect(taskCardsToMount(noTerminal, new Set())).toEqual([]);
  });
});
