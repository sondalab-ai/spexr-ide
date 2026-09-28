import { describe, expect, it } from "vitest";
import type { ScheduleSnapshot } from "../../../common/schedule/schedule-protocol.js";
import { adoptedSession, closesDestructively, liveTaskCards, taskCardsToMount } from "./schedule-wall.js";

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

describe("closesDestructively", () => {
  it("keeps a task card's terminal alive on close", () => {
    expect(closesDestructively("spexr-task-4", new Set(["spexr-task-4"]))).toBe(false);
  });
  it("disposes any other launched card's terminal on close, as before", () => {
    expect(closesDestructively("spexr-new-1", new Set(["spexr-task-4"]))).toBe(true);
    expect(closesDestructively("spexr-task-4", new Set())).toBe(true);
  });
});

describe("liveTaskCards", () => {
  it("maps each active task's card key to the session it runs, if known", () => {
    expect(liveTaskCards(snapshot("running"))).toEqual(new Map([["spexr-task-4", "u"]]));
    const noSession = snapshot("running");
    delete noSession.runs["s"]!.tasks["a"]!.sessionId;
    expect(liveTaskCards(noSession)).toEqual(new Map([["spexr-task-4", undefined]]));
  });
  it("leaves out a retried task's old terminal, a settled task, and an ended run", () => {
    const retried = snapshot("running");
    retried.runs["s"]!.tasks["a"]!.terminalId = 9;
    expect(liveTaskCards(retried).has("spexr-task-4")).toBe(false);
    const restarting = snapshot("starting");
    delete restarting.runs["s"]!.tasks["a"]!.terminalId;
    expect(liveTaskCards(restarting).size).toBe(0);
    expect(liveTaskCards(snapshot("failed")).size).toBe(0);
    expect(liveTaskCards(snapshot("converged")).size).toBe(0);
    expect(liveTaskCards(snapshot("running", "aborted")).size).toBe(0);
    expect(liveTaskCards({ schedules: [], runs: {} }).size).toBe(0);
  });
});

describe("adoptedSession", () => {
  const tile = (sessionId: string, projectPath = "/r", lastActivityMs = 1) => ({ sessionId, projectPath, lastActivityMs });
  it("a card that knows its session adopts only that session, never another in the same folder", () => {
    const retry = { key: "spexr-task-9", projectPath: "/r", knownBefore: new Set<string>(), sessionId: "new" };
    expect(adoptedSession(retry, [retry], [tile("old", "/r", 5)])).toBeUndefined();
    expect(adoptedSession(retry, [retry], [tile("old", "/r", 5), tile("new", "/r", 1)])).toBe("new");
  });
  it("after a retry the new session goes to the retry's card, not the failed attempt's (both in the same folder)", () => {
    const failed = { key: "spexr-task-4", projectPath: "/r", knownBefore: new Set<string>(), sessionId: "old" };
    const retry = { key: "spexr-task-9", projectPath: "/r", knownBefore: new Set<string>(), sessionId: "new" };
    const tiles = [tile("new", "/r", 9)];
    expect(adoptedSession(failed, [failed, retry], tiles)).toBeUndefined();
    expect(adoptedSession(retry, [failed, retry], tiles)).toBe("new");
  });
  it("a card without a session falls back to the folder match, skipping sessions other cards claim", () => {
    const oc = { key: "spexr-task-5", projectPath: "/r", knownBefore: new Set(["seen"]) };
    const claude = { key: "spexr-task-6", projectPath: "/r", knownBefore: new Set<string>(), sessionId: "c" };
    expect(adoptedSession(oc, [oc, claude], [tile("seen"), tile("c", "/r", 9)])).toBeUndefined();
    expect(adoptedSession(oc, [oc, claude], [tile("seen"), tile("c", "/r", 9), tile("o", "/r", 2)])).toBe("o");
  });
});
