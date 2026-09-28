import { describe, expect, it } from "vitest";
import type { ScheduleSnapshot } from "../../../common/schedule/schedule-protocol.js";
import { adoptedSession, closesDestructively, currentTaskCards, liveTaskCards, syncLaunchedTasks, taskCardsToMount } from "./schedule-wall.js";

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
      { key: "spexr-task-4", runId: "r", terminalId: 4, processId: 40, workspace: "/r", harness: "claude", sessionId: "u" },
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

describe("currentTaskCards", () => {
  it("maps every task terminal of each schedule's current run, whatever the task or run status", () => {
    for (const status of ["running", "starting", "failed", "converged", "interrupted", "skipped"]) {
      expect(currentTaskCards(snapshot(status)).get("spexr-task-4")).toEqual([{ runId: "r", sessionId: "u" }]);
    }
    expect(currentTaskCards(snapshot("running", "aborted")).get("spexr-task-4")).toEqual([{ runId: "r", sessionId: "u" }]);
    expect(currentTaskCards(snapshot("converged", "finished")).get("spexr-task-4")).toEqual([{ runId: "r", sessionId: "u" }]);
  });
  it("leaves out a task without a terminal (recover cleared it, or a retry is starting), and a deleted schedule's run", () => {
    const cleared = snapshot("failed");
    delete cleared.runs["s"]!.tasks["a"]!.terminalId;
    expect(currentTaskCards(cleared).size).toBe(0);
    const deleted = snapshot("running");
    deleted.schedules = [];
    expect(currentTaskCards(deleted).size).toBe(0);
    expect(currentTaskCards({ schedules: [], runs: {} }).size).toBe(0);
  });
});

describe("syncLaunchedTasks", () => {
  const tasks = new Set(["spexr-task-3", "spexr-task-4"]);
  const card = (sessionId?: string) => ({ key: "spexr-task-4", runId: "r", ...(sessionId ? { sessionId } : {}) });
  it("keeps a launcher card even though no task runs it", () => {
    const l = { key: "spexr-new-1" };
    expect(syncLaunchedTasks([l], tasks, currentTaskCards(snapshot("running")))).toEqual({ kept: [l], dropped: [] });
  });
  it("keeps a task card whose task failed, converged, or was interrupted, or whose run was aborted or finished", () => {
    for (const s of [snapshot("failed"), snapshot("converged"), snapshot("interrupted"), snapshot("running", "aborted"), snapshot("converged", "finished")]) {
      expect(syncLaunchedTasks([card("u")], tasks, currentTaskCards(s))).toEqual({ kept: [card("u")], dropped: [] });
    }
  });
  it("drops a task card once a retry gives its task a new terminal", () => {
    const retried = snapshot("starting");
    retried.runs["s"]!.tasks["a"]!.terminalId = 9;
    expect(syncLaunchedTasks([card("u")], tasks, currentTaskCards(retried))).toEqual({ kept: [], dropped: ["spexr-task-4"] });
    const restarting = snapshot("starting");
    delete restarting.runs["s"]!.tasks["a"]!.terminalId;
    expect(syncLaunchedTasks([card("u")], tasks, currentTaskCards(restarting)).dropped).toEqual(["spexr-task-4"]);
  });
  it("drops a task card when a new run replaced its run, even on the same terminal id", () => {
    const next = snapshot("running");
    next.runs["s"]!.runId = "r2";
    expect(syncLaunchedTasks([card("u")], tasks, currentTaskCards(next))).toEqual({ kept: [], dropped: ["spexr-task-4"] });
  });
  it("drops a task card when its schedule is deleted", () => {
    expect(syncLaunchedTasks([card("u")], tasks, currentTaskCards({ schedules: [], runs: {} })).dropped).toEqual(["spexr-task-4"]);
  });
  it("a kept task card learns the session its task now runs", () => {
    expect(syncLaunchedTasks([card()], tasks, currentTaskCards(snapshot("failed"))).kept).toEqual([card("u")]);
  });
  it("a kept task card whose task has no session yet keeps its own, unchanged", () => {
    const noSession = snapshot("running");
    delete noSession.runs["s"]!.tasks["a"]!.sessionId;
    const mine = card("mine");
    expect(syncLaunchedTasks([mine], tasks, currentTaskCards(noSession)).kept[0]).toBe(mine);
    const same = card("u");
    expect(syncLaunchedTasks([same], tasks, currentTaskCards(snapshot("running"))).kept[0]).toBe(same);
  });
  it("a sync-drop frees the key, so a fresher snapshot mounts the card again", () => {
    const mounted = new Set(["spexr-task-4"]);
    const stale: ScheduleSnapshot = { schedules: snapshot("running").schedules, runs: {} };
    const { dropped } = syncLaunchedTasks([card("u")], mounted, currentTaskCards(stale));
    expect(dropped).toEqual(["spexr-task-4"]);
    for (const key of dropped) mounted.delete(key);
    expect(taskCardsToMount(snapshot("running"), mounted).map((c) => c.key)).toEqual(["spexr-task-4"]);
  });
  it("a user-closed task card (key kept, card gone) is not remounted", () => {
    const mounted = new Set(["spexr-task-4"]);
    expect(syncLaunchedTasks([], mounted, currentTaskCards(snapshot("running")))).toEqual({ kept: [], dropped: [] });
    expect(taskCardsToMount(snapshot("running"), mounted)).toEqual([]);
  });
  it("a card keyed like another schedule's older run (terminal ids restart with the backend) is judged on its own run", () => {
    const task = (id: string) => ({ id: "a", name: "A", needs: [], project: `/${id}`, workspace: { kind: "folder" as const }, harness: "claude" as const, prompt: "p" });
    const runOf = (scheduleId: string, runId: string, status: string, taskStatus: string, sessionId: string) => ({
      scheduleId, runId, status: status as never, startedAtMs: 0, launches: {},
      tasks: { a: { status: taskStatus as never, iteration: 1, terminalId: 4, processId: scheduleId === "A" ? 41 : 42, workspace: `/${scheduleId}`, sessionId } },
    });
    const runs = { A: runOf("A", "rA", "finished", "converged", "sa"), B: runOf("B", "rB", "running", "running", "sb") };
    const b = { key: "spexr-task-4", runId: "rB", sessionId: "sb" };
    for (const order of [["A", "B"], ["B", "A"]]) {
      const snap: ScheduleSnapshot = { schedules: order.map((id) => ({ id, name: id, tasks: [task(id)] })), runs };
      expect(syncLaunchedTasks([b], tasks, currentTaskCards(snap))).toEqual({ kept: [b], dropped: [] });
      expect(taskCardsToMount(snap, new Set()).map((c) => [c.key, c.runId, c.processId])).toEqual([["spexr-task-4", "rB", 42]]);
    }
  });
  it("a kept failed card never adopts the session of the retry after it", () => {
    const failed = syncLaunchedTasks([card()], tasks, currentTaskCards(snapshot("failed"))).kept[0]!;
    const adoptable = { ...failed, projectPath: "/r", knownBefore: new Set<string>() };
    expect(adoptedSession(adoptable, [adoptable], [{ sessionId: "retry", projectPath: "/r", lastActivityMs: 9 }])).toBeUndefined();
  });
});
