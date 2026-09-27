import { describe, expect, it } from "vitest";
import type { Schedule, ScheduleTask } from "./schedule-types.js";
import { findCycle, layersOf, mayRunTogether, staticFolder, upstreamOf } from "./schedule-graph.js";

function task(id: string, needs: string[] = [], extra: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id,
    name: id,
    needs,
    project: "/repo",
    workspace: { kind: "folder" },
    harness: "claude",
    prompt: "do it",
    ...extra,
  };
}
const sched = (...tasks: ScheduleTask[]): Schedule => ({ id: "s", name: "S", tasks });

describe("upstreamOf", () => {
  it("collects every task reachable through needs", () => {
    const s = sched(task("a"), task("b", ["a"]), task("c", ["b"]));
    expect([...upstreamOf(s, "c")].sort()).toEqual(["a", "b"]);
    expect(upstreamOf(s, "a").size).toBe(0);
  });
  it("ignores unknown ids and terminates on a cycle", () => {
    const s = sched(task("a", ["b", "zz"]), task("b", ["a"]));
    expect([...upstreamOf(s, "a")].sort()).toEqual(["a", "b"]);
  });
});

describe("findCycle", () => {
  it("returns undefined for a graph without cycles", () => {
    expect(findCycle(sched(task("a"), task("b", ["a"])))).toBeUndefined();
  });
  it("names the tasks on a cycle, closing it", () => {
    const cycle = findCycle(sched(task("a", ["c"]), task("b", ["a"]), task("c", ["b"])));
    expect(cycle).toBeDefined();
    expect(cycle![0]).toBe(cycle![cycle!.length - 1]);
    expect(new Set(cycle)).toEqual(new Set(["a", "b", "c"]));
  });
  it("finds a self-loop", () => {
    expect(findCycle(sched(task("a", ["a"])))).toEqual(["a", "a"]);
  });
});

describe("mayRunTogether", () => {
  it("is false when one task is upstream of the other", () => {
    const s = sched(task("a"), task("b", ["a"]), task("c", ["b"]));
    expect(mayRunTogether(s, "a", "c")).toBe(false);
    expect(mayRunTogether(s, "c", "a")).toBe(false);
  });
  it("is true for siblings", () => {
    const s = sched(task("a"), task("b", ["a"]), task("c", ["a"]));
    expect(mayRunTogether(s, "b", "c")).toBe(true);
  });
});

describe("layersOf", () => {
  it("groups tasks by depth, in schedule order within a layer", () => {
    const s = sched(task("a"), task("x"), task("b", ["a"]), task("c", ["a", "b"]));
    expect(layersOf(s)).toEqual([["a", "x"], ["b"], ["c"]]);
  });
});

describe("staticFolder", () => {
  it("resolves folder, worktree and sameAs chains", () => {
    const s = sched(
      task("a"),
      task("w", [], { workspace: { kind: "worktree" } }),
      task("b", ["w"], { workspace: { kind: "sameAs", task: "w" } }),
      task("c", ["b"], { workspace: { kind: "sameAs", task: "b" } }),
    );
    expect(staticFolder(s, "a")).toBe("/repo");
    expect(staticFolder(s, "w")).toBe("worktree:w");
    expect(staticFolder(s, "c")).toBe("worktree:w");
  });
  it("normalizes a trailing slash on the project", () => {
    const s = sched(task("a", [], { project: "/repo/" }));
    expect(staticFolder(s, "a")).toBe("/repo");
  });
  it("stops on a sameAs loop instead of recursing forever", () => {
    const s = sched(
      task("a", [], { workspace: { kind: "sameAs", task: "b" } }),
      task("b", [], { workspace: { kind: "sameAs", task: "a" } }),
    );
    expect(staticFolder(s, "a")).toMatch(/^unresolved:/);
  });
});
