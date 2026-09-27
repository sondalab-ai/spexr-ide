import { describe, expect, it } from "vitest";
import type { Schedule, ScheduleTask } from "./schedule-types.js";
import { validateSchedule } from "./schedule-validate.js";

function task(id: string, extra: Partial<ScheduleTask> = {}): ScheduleTask {
  return {
    id,
    name: id,
    needs: [],
    project: `/repo-${id}`,
    workspace: { kind: "folder" },
    harness: "claude",
    prompt: "do it",
    ...extra,
  };
}
const sched = (...tasks: ScheduleTask[]): Schedule => ({ id: "s", name: "S", tasks });
const fields = (s: Schedule): string[] => validateSchedule(s).map((p) => `${p.task ?? "*"}:${p.field}`);

describe("validateSchedule", () => {
  it("accepts a valid graph", () => {
    expect(validateSchedule(sched(task("a"), task("b", { needs: ["a"] })))).toEqual([]);
  });
  it("rejects a bad schedule id, an empty name and an empty task list", () => {
    expect(fields({ id: "Bad Id", name: " ", tasks: [] }).sort()).toEqual(["*:id", "*:name", "*:tasks"]);
  });
  it("rejects bad and duplicate task ids", () => {
    // distinct projects, so the shared-folder guard stays out of this test
    expect(fields(sched(task("A!"), task("b"), task("b", { project: "/other" })))).toEqual(["A!:id", "b:id"]);
  });
  it("rejects unknown and self needs", () => {
    expect(fields(sched(task("a", { needs: ["zz"] })))).toEqual(["a:needs"]);
    expect(fields(sched(task("a", { needs: ["a"] })))).toContain("a:needs");
  });
  it("names the tasks on a cycle", () => {
    const problems = validateSchedule(sched(task("a", { needs: ["b"] }), task("b", { needs: ["a"] })));
    expect(problems).toHaveLength(1);
    expect(problems[0]!.message).toMatch(/a → b → a|b → a → b/);
  });
  it("rejects a sameAs that is unknown or not upstream", () => {
    expect(fields(sched(task("a", { workspace: { kind: "sameAs", task: "zz" } })))).toContain("a:workspace");
    expect(
      fields(sched(task("a"), task("b", { workspace: { kind: "sameAs", task: "a" } }))),
    ).toContain("b:workspace");
  });
  it("rejects a placeholder naming a task that is not upstream", () => {
    expect(fields(sched(task("a"), task("b", { prompt: "use {{a.reply}}" })))).toEqual(["b:prompt"]);
    expect(fields(sched(task("a"), task("b", { needs: ["a"], prompt: "use {{a.reply}}" })))).toEqual([]);
  });
  it("rejects a relative project path", () => {
    expect(fields(sched(task("a", { project: "repo" })))).toEqual(["a:project"]);
  });
  it("rejects an unknown harness, permission mode and model", () => {
    expect(fields(sched(task("a", { harness: "codex" as never })))).toEqual(["a:harness"]);
    expect(fields(sched(task("a", { permissionMode: "default" })))).toEqual(["a:permissionMode"]);
    expect(fields(sched(task("a", { harness: "opencode", permissionMode: "plan" })))).toEqual(["a:permissionMode"]);
    expect(fields(sched(task("a", { model: "sonnet; rm -rf ~" })))).toEqual(["a:model"]);
  });
  it("rejects an empty, overlong or dash-leading prompt", () => {
    expect(fields(sched(task("a", { prompt: "  " })))).toEqual(["a:prompt"]);
    expect(fields(sched(task("a", { prompt: "x".repeat(20_001) })))).toEqual(["a:prompt"]);
    expect(fields(sched(task("a", { prompt: "--help" })))).toEqual(["a:prompt"]);
  });
  it("rejects loop limits and empty loop texts", () => {
    const loop = { stopCriteria: "s", followUp: "f", maxIterations: 51 };
    expect(fields(sched(task("a", { loop })))).toEqual(["a:loop.maxIterations"]);
    expect(fields(sched(task("a", { loop: { ...loop, maxIterations: 3, stopCriteria: " " } })))).toEqual([
      "a:loop.stopCriteria",
    ]);
    expect(fields(sched(task("a", { loop: { ...loop, maxIterations: 3, followUp: "" } })))).toEqual([
      "a:loop.followUp",
    ]);
  });
  it("rejects a blank check, placeholders in the check or the follow-up (R6), and a check timeout out of range (R7)", () => {
    const loop = { stopCriteria: "tests pass", followUp: "keep going", maxIterations: 3 };
    expect(fields(sched(task("a", { loop: { ...loop, check: "  " } })))).toEqual(["a:loop.check"]);
    expect(
      fields(sched(task("a"), task("b", { needs: ["a"], loop: { ...loop, check: "grep -q ok {{a.workspace}}/log" } }))),
    ).toEqual(["b:loop.check"]);
    expect(fields(sched(task("a"), task("b", { needs: ["a"], loop: { ...loop, followUp: "see {{a.reply}}" } })))).toEqual([
      "b:loop.followUp",
    ]);
    expect(fields(sched(task("a", { loop: { ...loop, check: "pnpm test", checkTimeoutSec: 0 } })))).toEqual([
      "a:loop.checkTimeoutSec",
    ]);
    expect(fields(sched(task("a", { loop: { ...loop, check: "pnpm test", checkTimeoutSec: 3_601 } })))).toEqual([
      "a:loop.checkTimeoutSec",
    ]);
    expect(fields(sched(task("a", { loop: { ...loop, check: "pnpm test", checkTimeoutSec: 1.5 } })))).toEqual([
      "a:loop.checkTimeoutSec",
    ]);
    expect(validateSchedule(sched(task("a", { loop: { ...loop, check: "pnpm test", checkTimeoutSec: 900 } })))).toEqual([]);
  });
  it("rejects a follow-up that starts with a slash, bang or hash — the agent's terminal would read it as a command", () => {
    const loop = { stopCriteria: "tests pass", maxIterations: 3 };
    expect(fields(sched(task("a", { loop: { ...loop, followUp: "/clear" } })))).toEqual(["a:loop.followUp"]);
    expect(fields(sched(task("a", { loop: { ...loop, followUp: "!ls" } })))).toEqual(["a:loop.followUp"]);
    expect(fields(sched(task("a", { loop: { ...loop, followUp: "#note" } })))).toEqual(["a:loop.followUp"]);
    expect(fields(sched(task("a", { loop: { ...loop, followUp: "  /clear" } })))).toEqual(["a:loop.followUp"]);
    expect(fields(sched(task("a", { loop: { ...loop, followUp: "see / for details" } })))).toEqual([]);
  });

  describe("concurrency guard (AC-2)", () => {
    it("rejects two tasks that may run together in one folder", () => {
      const s = sched(task("a", { project: "/repo" }), task("b", { project: "/repo/" }));
      expect(fields(s)).toEqual(["b:workspace"]);
    });
    it("accepts the same two tasks when one waits for the other", () => {
      const s = sched(task("a", { project: "/repo" }), task("b", { project: "/repo", needs: ["a"] }));
      expect(validateSchedule(s)).toEqual([]);
    });
    it("accepts siblings in separate worktrees of one project", () => {
      const s = sched(
        task("a", { project: "/repo", workspace: { kind: "worktree" } }),
        task("b", { project: "/repo", workspace: { kind: "worktree" } }),
      );
      expect(validateSchedule(s)).toEqual([]);
    });
    it("rejects two siblings sharing an upstream worktree", () => {
      const s = sched(
        task("w", { project: "/repo", workspace: { kind: "worktree" } }),
        task("b", { needs: ["w"], workspace: { kind: "sameAs", task: "w" } }),
        task("c", { needs: ["w"], workspace: { kind: "sameAs", task: "w" } }),
      );
      expect(fields(s)).toEqual(["c:workspace"]);
    });
  });

  it("regression: reports all problems including id errors and workspace collisions", () => {
    const s = { id: "Bad Id", name: "S", tasks: [task("a", { project: "/repo" }), task("b", { project: "/repo" })] };
    const problems = validateSchedule(s);
    const problemFields = problems.map((p) => `${p.task ?? "*"}:${p.field}`);
    expect(problemFields).toContain("*:id");
    expect(problemFields).toContain("b:workspace");
  });
});
