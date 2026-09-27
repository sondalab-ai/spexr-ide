# Plant Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **What is this file.** Implementation plan for spec 0018. Audience: whoever
> implements it (human or agent). Owner: marcello.barile. The spec
> (`docs/specs/0018-plant-schedule.md`) is the contract; this file is the order
> of work. Slices 1–4 are planned task by task.

**Goal:** Let the operator define a dependency graph of agent sessions in a Dark Factory sidebar and run it, each session a live wall card.

**Architecture:** Pure, browser-safe model/validation/prompt modules in `common/schedule/`; a pure state machine (`step`) plus a thin runner with injected ports in `node/schedule/`; a backend RPC service owning runs (so they survive window reloads); a React sidebar in the Dark Factory widget whose logic lives in pure `.ts` view-model modules.

**Tech Stack:** TypeScript 6 strict, Theia 1.75 (inversify DI, JSON-RPC `RpcConnectionHandler`, `@theia/terminal` `ShellTerminalServer`, `@theia/process` `ProcessManager`), React 19, Vitest, `@sondalab/ui-kit`.

**Spec:** `docs/specs/0018-plant-schedule.md`

## Global Constraints

- All paths below are relative to `packages/theia-extensions/` unless they start with `docs/`.
- Vitest includes only `src/**/*.test.ts`: no `.tsx` tests. Sidebar logic goes in pure `.ts` modules; `.tsx` files only render.
- Run tests with `--maxWorkers=2`, focused on the files touched: `npx vitest run --maxWorkers=2 <paths>`. Never the whole repo unthrottled (`docs/memory/never-run-full-pnpm-test-or-the-full-e2e-suite-unthrottled-i.md`).
- After each task: `pnpm run lint` and `pnpm run typecheck` in `packages/theia-extensions`.
- Imports use the `.js` extension (ESM), as every existing file does.
- `common/` never imports `node:*` or `node/`; `browser/` never imports `node/` (spec 0012/0013).
- Ids: `^[a-z0-9-]{1,32}$` (schedule and task). `maxIterations`: 1..50. Prompt: 1..20 000 characters, must not start with `-`. Model: `^[A-Za-z0-9._/:\[\]-]{1,100}$`.
- Claude permission modes: `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. opencode: `auto` only. Warned modes: claude `auto`, `bypassPermissions`; opencode `auto`.
- Marker: the literal line `CONVERGED`. Store: `~/.spexr/schedules.json`, override `SPEXR_SCHEDULES`.
- A Claude task with no transcript after 8 s shows *Needs you* (startup dialog) and fails only when its pty exits; an opencode session must appear within 120 s (scan-driven).
- UI: kit components and `--sl-*` tokens only, no raw colours; both themes; Run is the only primary button (spec, Look and feel).
- One commit per task; message style `feat(schedule): …` / `refactor(darkfactory): …`, ending with the `Co-Authored-By` line the session provides.

## Review Focus

1. **A pasted follow-up counted as a second turn end.** Right after a turn ends the transcript still ends with that reply; the tracker must not report "turn ended" again until it has seen the agent working. Pinned in Task 7 (`TurnTracker` "does not report the same ended turn twice").
2. **A reply split over several assistant entries.** The final reply is every assistant text block after the last genuine prompt, not the last entry. Pinned in Task 7 (`finalReply` "joins the whole last turn").
3. **A damaged `schedules.json`.** Treating a parse failure as "no schedules" and then saving would erase the operator's work. The store moves the bad file aside before starting empty. Pinned in Task 4.
4. **A transcript that never appears** — usually Claude's folder-trust dialog (probe, 2026-09-27). The task must show *Needs you*, not sit silently in `running`, and must fail when the pty exits. Pinned in Task 8 ("reports needs-you while no transcript exists") and Task 11 ("fails the task when the pty exits first").
5. **Parallel check commands overloading the machine** (several `pnpm test` at once; the 18 GB machine crashed on 2026-09-24). Checks are serialized backend-wide and killed by process group on timeout. Pinned in Task 15 ("kills the whole process group on timeout: a child sleep is gone too", "two tasks' real checks never overlap", "returns even when a process outside the group keeps the output open").
6. **A check's output breaking out of the paste.** The follow-up carries check output written by agent-authored code; an embedded `ESC[201~` would end the bracketed paste and turn the rest into keystrokes. Pinned in Task 16 (`bracketedPaste` "cannot be broken out of"). Review Focus 1 extends to pastes: re-arming must not count the reply still on screen — pinned in Task 16 ("never counts the reply still on screen again", both watchers).
7. **A retry that makes a fresh worktree, or a rerun that silently builds on an old one.** Retry must continue in the task's own worktree; a new Run must refuse a leftover (R15). Pinned in Task 24 ("a retry continues in the same worktree…", "a new run refuses a worktree left from an earlier run…") and Task 26 ("retry reuses the task's worktree…").
8. **A skipped task's reply leaking into its dependents.** A failed task may already have replied; after Skip its placeholders must render empty. Pinned in Task 22 ("skip lets dependents start, and the skipped task's placeholders render empty even when it replied") and Task 26 ("skip lets the dependent start…").
9. **Pauses after retry and skip.** A failure pause clears only when nothing else is failed or interrupted; an operator pause survives both. Pinned in Task 22 ("a failure pause clears only when…", "an operator pause survives retry and skip…").
10. **`sameAs` in the wrong folder.** It must resolve to the upstream's real worktree, and never fall back to the project folder. Pinned in Task 23 (`workspacePlan`) and Task 26 ("runs a sameAs task in its upstream's real worktree…", "fails a sameAs task whose upstream never got its worktree…").
11. **Siblings serialized by accident.** Two ready tasks in separate worktrees must both be launched before either starts. Pinned in Task 26 ("starts two siblings in separate worktrees together…") and Task 24 ("two siblings prepared at once…").
12. **Git through a shell.** Pinned in Task 24 ("never goes through a shell: a repository whose path is shell syntax…").
13. **Closing someone else's terminal, or re-attaching a dead one.** Retry resets the task to a bare state (R12); every close is checked against the recorded process id and never applies to an interrupted task (R13). Pinned in Task 22 ("retry of an interrupted task never closes a terminal…") and Task 25 (`SchedulePty.close` "leaves alone a terminal id that now runs another process").
14. **Invisible ptys.** A launch for an aborted or replaced run, or one whose watcher failed, is closed (R14). Pinned in Task 25.

---

## File structure

| File | Responsibility |
|---|---|
| `src/common/schedule/schedule-types.ts` | Schedule, task, run-state types and limits |
| `src/common/schedule/schedule-graph.ts` | Upstream sets, cycle search, "may run together", layers, static folder resolution |
| `src/common/schedule/schedule-validate.ts` | `validateSchedule` |
| `src/common/schedule/schedule-prompt.ts` | Placeholders, first/follow-up prompt assembly, marker detection |
| `src/common/schedule/schedule-protocol.ts` | RPC path, service and client interfaces |
| `src/common/harness/launch-line.ts` | Shared login-shell launch line (moved out of the wall's terminal manager) |
| `src/common/schedule/task-args.ts` | Harness CLI arguments for a task |
| `src/node/schedule/schedule-store.ts` | Atomic JSON store |
| `src/node/schedule/schedule-engine.ts` | Pure `startRun` / `step` state machine |
| `src/node/schedule/turn-tracker.ts` | Turn transitions from entries or tile state; `finalReply` |
| `src/node/schedule/claude-task-watcher.ts` | Find and follow a Claude task transcript |
| `src/node/schedule/opencode-task-watcher.ts` | Read an opencode task from the wall's scans |
| `src/node/schedule/schedule-runner.ts` | Serialized dispatch, effects, watcher lifetimes |
| `src/node/schedule/schedule-pty.ts` | Backend pty via `ShellTerminalServer` + `ProcessManager`; bracketed paste then Enter |
| `src/node/schedule/check-runner.ts` | Check command in a login shell, process-group kill on timeout, backend-wide FIFO queue |
| `src/node/schedule/workspace.ts` | Worktree workspaces: path and branch, fresh or reused, git via `execFile`, one change at a time per repository |
| `src/node/schedule/spexr-schedule-backend-service.ts` | RPC service |
| `src/node/darkfactory/spexr-darkfactory-backend-service.ts` | + scan announcements for opencode tasks |
| `src/node/darkfactory/session-state.ts` | export `lastTurn`, `AUTO_APPROVE_MODES`, `SETTLE_MS` |
| `src/browser/darkfactory/darkfactory-terminal-manager.ts` | use shared launch line; public `resolveLaunch` |
| `src/browser/darkfactory/schedule/schedule-client.ts` | Client dispatcher |
| `src/browser/darkfactory/schedule/schedule-view.ts` | Pure view model: rows, status labels, run bar |
| `src/browser/darkfactory/schedule/schedule-wall.ts` | Pure: which task terminals the wall must mount |
| `src/browser/darkfactory/schedule/sidebar-prefs.ts` | Sidebar width/open in localStorage |
| `src/browser/darkfactory/schedule/loop-edit.ts` | Pure: switch the loop on/off, edit its fields and check |
| `src/browser/darkfactory/schedule/task-edit.ts` | Pure: "waits for", workspace, hand-off and account choices |
| `src/browser/darkfactory/schedule/schedule-sidebar.tsx` | Sidebar React component |
| `src/browser/darkfactory/darkfactory-wall-widget.tsx` | Shell row layout, sidebar, mount task cards |
| `src/browser/style/spexr.css` | Sidebar styles |
| `src/node/spexr-backend-module.ts`, `src/browser/spexr-frontend-module.ts` | Bindings |

---

# Slice 1 — Model, validation and store

### Task 1: Types and graph helpers

**Files:**
- Create: `src/common/schedule/schedule-types.ts`
- Create: `src/common/schedule/schedule-graph.ts`
- Test: `src/common/schedule/schedule-graph.test.ts`

**Interfaces:**
- Produces: all types below; `upstreamOf(s, id): Set<string>`, `findCycle(s): string[] | undefined`, `mayRunTogether(s, a, b): boolean`, `layersOf(s): string[][]`, `staticFolder(s, id): string`.

- [ ] **Step 1: Write the types**

```ts
// src/common/schedule/schedule-types.ts
import type { HarnessId } from "../harness/harness-types.js";
import type { LaunchPlan } from "../claude-launch-profiles.js";

export const SCHEDULE_ID_PATTERN = /^[a-z0-9-]{1,32}$/;
export const MODEL_PATTERN = /^[A-Za-z0-9._/:[\]-]{1,100}$/;
export const MAX_ITERATIONS = 50;
export const MAX_PROMPT_CHARS = 20_000;
export const DEFAULT_CHECK_TIMEOUT_SEC = 600;
export const SCHEDULE_HARNESSES: readonly HarnessId[] = ["claude", "opencode"];
export const PERMISSION_MODES: Readonly<Record<HarnessId, readonly string[]>> = {
  claude: ["acceptEdits", "auto", "bypassPermissions", "manual", "dontAsk", "plan"],
  opencode: ["auto"],
};
/** Modes that approve tools without asking; the editor and the task row warn about them. */
export const UNATTENDED_MODES: Readonly<Record<HarnessId, readonly string[]>> = {
  claude: ["auto", "bypassPermissions"],
  opencode: ["auto"],
};

export type TaskWorkspace = { kind: "folder" } | { kind: "worktree" } | { kind: "sameAs"; task: string };

export interface TaskLoop {
  stopCriteria: string;
  followUp: string;
  maxIterations: number;
  check?: string;
  checkTimeoutSec?: number;
}

export interface ScheduleTask {
  id: string;
  name: string;
  needs: string[];
  project: string;
  workspace: TaskWorkspace;
  harness: HarnessId;
  configDir?: string;
  model?: string;
  permissionMode?: string;
  prompt: string;
  loop?: TaskLoop;
}

export interface Schedule {
  id: string;
  name: string;
  tasks: ScheduleTask[];
}

/** One validation problem; `task` absent means the schedule itself. */
export interface ValidationProblem {
  task?: string;
  field: string;
  message: string;
}

export type TaskStatus =
  | "pending"
  | "starting"
  | "running"
  | "waiting-on-you"
  | "checking"
  | "held"
  | "converged"
  | "failed"
  | "skipped"
  | "interrupted";

/** A task's status is one of these while a session may still be doing its work. */
export const ACTIVE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "starting",
  "running",
  "waiting-on-you",
  "checking",
  "held",
]);
/** A dependent may start once every task it needs is in one of these. */
export const SETTLED_STATUSES: ReadonlySet<TaskStatus> = new Set(["converged", "skipped"]);

export interface TaskRunState {
  status: TaskStatus;
  iteration: number;
  sessionId?: string;
  terminalId?: number;
  processId?: number;
  workspace?: string;
  reply?: string;
  error?: string;
}

/** How the frontend resolved a task's launch: the command and the account dir. */
export interface TaskLaunch {
  plan: LaunchPlan;
  /** The Claude account dir the session runs under; "" is the default account (~/.claude). */
  configDir: string;
}

export type RunStatus = "running" | "finished" | "aborted";

export interface RunState {
  scheduleId: string;
  runId: string;
  status: RunStatus;
  /** Set while no new task may start: by the operator, or by a failed/interrupted task. */
  pausedBy?: "operator" | "failure";
  startedAtMs: number;
  tasks: Record<string, TaskRunState>;
  launches: Record<string, TaskLaunch>;
}
```

- [ ] **Step 2: Write the failing graph tests**

```ts
// src/common/schedule/schedule-graph.test.ts
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/common/schedule/schedule-graph.test.ts`
Expected: FAIL — cannot resolve `./schedule-graph.js`.

- [ ] **Step 4: Implement**

```ts
// src/common/schedule/schedule-graph.ts
import type { Schedule, ScheduleTask } from "./schedule-types.js";

function byId(s: Schedule): Map<string, ScheduleTask> {
  return new Map(s.tasks.map((t) => [t.id, t]));
}

/**
 * Every task `id` waits for, directly or through others. Unknown ids are
 * skipped; on a cycle the walk still ends (a task can then be its own upstream).
 */
export function upstreamOf(s: Schedule, id: string): Set<string> {
  const tasks = byId(s);
  const seen = new Set<string>();
  const stack = [...(tasks.get(id)?.needs ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next) || !tasks.has(next)) continue;
    seen.add(next);
    stack.push(...tasks.get(next)!.needs);
  }
  return seen;
}

/**
 * One cycle in the `needs` graph as a closed path (`[a, b, a]`), or undefined.
 * Depth-first search with three colours; unknown ids are ignored.
 */
export function findCycle(s: Schedule): string[] | undefined {
  const tasks = byId(s);
  const colour = new Map<string, "grey" | "black">();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    colour.set(id, "grey");
    path.push(id);
    for (const dep of tasks.get(id)?.needs ?? []) {
      if (!tasks.has(dep)) continue;
      if (colour.get(dep) === "grey") return [...path.slice(path.indexOf(dep)), dep];
      if (!colour.has(dep)) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    path.pop();
    colour.set(id, "black");
    return undefined;
  };
  for (const t of s.tasks) {
    if (colour.has(t.id)) continue;
    const found = visit(t.id);
    if (found) return found;
  }
  return undefined;
}

/** True when neither task waits for the other, so a run may have both going at once. */
export function mayRunTogether(s: Schedule, a: string, b: string): boolean {
  return !upstreamOf(s, a).has(b) && !upstreamOf(s, b).has(a);
}

/**
 * Tasks grouped by depth: a task with no needs is at depth 0, any other one
 * level below its deepest upstream task. Assumes an acyclic graph.
 */
export function layersOf(s: Schedule): string[][] {
  const tasks = byId(s);
  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const needs = (tasks.get(id)?.needs ?? []).filter((n) => tasks.has(n));
    const d = needs.length === 0 ? 0 : 1 + Math.max(...needs.map(depthOf));
    depth.set(id, d);
    return d;
  };
  const layers: string[][] = [];
  for (const t of s.tasks) (layers[depthOf(t.id)] ??= []).push(t.id);
  return layers.filter(Boolean);
}

/**
 * The folder a task works in, as far as it is known before a run: the project
 * for `folder`, a token unique to the task for `worktree` (its path is only
 * made at start), and the target's folder for `sameAs`. Used to keep tasks that
 * may run together out of each other's folder.
 */
export function staticFolder(s: Schedule, id: string, hops = 0): string {
  const t = byId(s).get(id);
  if (!t || hops > s.tasks.length) return `unresolved:${id}`;
  switch (t.workspace.kind) {
    case "folder":
      return t.project.replace(/\/+$/, "") || t.project;
    case "worktree":
      return `worktree:${t.id}`;
    case "sameAs":
      return staticFolder(s, t.workspace.task, hops + 1);
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/common/schedule/schedule-graph.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Lint, typecheck, commit**

```bash
pnpm run lint && pnpm run typecheck
git add src/common/schedule/schedule-types.ts src/common/schedule/schedule-graph.ts src/common/schedule/schedule-graph.test.ts
git commit -m "feat(schedule): schedule types and graph helpers (spec 0018)"
```

### Task 2: Prompt assembly, placeholders and the marker

**Files:**
- Create: `src/common/schedule/schedule-prompt.ts`
- Test: `src/common/schedule/schedule-prompt.test.ts`

**Interfaces:**
- Consumes: `ScheduleTask` (Task 1).
- Produces: `CONVERGED_MARKER`, `MAX_REPLY_CHARS`, `placeholdersIn(text): {task: string; field: "reply" | "workspace"}[]`, `fillPlaceholders(text, lookup): string`, `firstPrompt(task, filled): string`, `followUpPrompt(task, checkFailure?): string`, `hasConverged(reply): boolean`, `stripMarker(reply): string`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/common/schedule/schedule-prompt.test.ts
import { describe, expect, it } from "vitest";
import type { ScheduleTask } from "./schedule-types.js";
import {
  CONVERGED_MARKER,
  MAX_REPLY_CHARS,
  fillPlaceholders,
  firstPrompt,
  followUpPrompt,
  hasConverged,
  placeholdersIn,
  stripMarker,
} from "./schedule-prompt.js";

const base: ScheduleTask = {
  id: "t",
  name: "T",
  needs: [],
  project: "/repo",
  workspace: { kind: "folder" },
  harness: "claude",
  prompt: "Fix the build.",
};

describe("placeholdersIn", () => {
  it("finds reply and workspace references, tolerating inner spaces", () => {
    expect(placeholdersIn("see {{ api.reply }} in {{api.workspace}}")).toEqual([
      { task: "api", field: "reply" },
      { task: "api", field: "workspace" },
    ]);
  });
  it("ignores unknown fields", () => {
    expect(placeholdersIn("{{api.secret}}")).toEqual([]);
  });
});

describe("fillPlaceholders", () => {
  it("replaces each reference, and an unknown one with nothing", () => {
    const out = fillPlaceholders("A={{a.reply}} B={{b.workspace}}", (task, field) =>
      task === "a" && field === "reply" ? "done" : undefined,
    );
    expect(out).toBe("A=done B=");
  });
  it("cuts a long reply to MAX_REPLY_CHARS and says so", () => {
    const out = fillPlaceholders("{{a.reply}}", () => "x".repeat(MAX_REPLY_CHARS + 10));
    expect(out.startsWith("x".repeat(MAX_REPLY_CHARS))).toBe(true);
    expect(out).toMatch(/cut to \d+ characters/);
  });
});

describe("firstPrompt", () => {
  it("is the filled prompt alone for a task without a loop", () => {
    expect(firstPrompt(base, "Fix the build.")).toBe("Fix the build.");
  });
  it("appends the stop criteria and the marker instruction for a looping task", () => {
    const looped = { ...base, loop: { stopCriteria: "All tests pass.", followUp: "Go on.", maxIterations: 3 } };
    const p = firstPrompt(looped, "Fix the build.");
    expect(p.startsWith("Fix the build.")).toBe(true);
    expect(p).toContain("All tests pass.");
    expect(p).toContain(CONVERGED_MARKER);
  });
});

describe("followUpPrompt", () => {
  const looped = { ...base, loop: { stopCriteria: "S", followUp: "Keep going.", maxIterations: 3, check: "pnpm test" } };
  it("repeats the marker reminder", () => {
    const p = followUpPrompt(looped);
    expect(p.startsWith("Keep going.")).toBe(true);
    expect(p).toContain(CONVERGED_MARKER);
  });
  it("carries a failed check's command and output", () => {
    const p = followUpPrompt(looped, { command: "pnpm test", tail: "1 failed" });
    expect(p).toContain("pnpm test");
    expect(p).toContain("1 failed");
  });
});

describe("hasConverged", () => {
  it("accepts the marker as the last non-empty line, with light markdown", () => {
    expect(hasConverged("All done.\n\nCONVERGED\n\n")).toBe(true);
    expect(hasConverged("All done.\n**CONVERGED**")).toBe(true);
    expect(hasConverged("All done.\n`CONVERGED`")).toBe(true);
  });
  it("rejects the marker anywhere else", () => {
    expect(hasConverged("I will write CONVERGED when done.\nNot yet.")).toBe(false);
    expect(hasConverged("CONVERGED\nmore work")).toBe(false);
    expect(hasConverged("NOT CONVERGED")).toBe(false);
    expect(hasConverged("")).toBe(false);
  });
});

describe("stripMarker", () => {
  it("drops a closing marker line and keeps everything else", () => {
    expect(stripMarker("Done.\nCONVERGED\n")).toBe("Done.");
    expect(stripMarker("Done.")).toBe("Done.");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/common/schedule/schedule-prompt.test.ts`
Expected: FAIL — cannot resolve `./schedule-prompt.js`.

- [ ] **Step 3: Implement**

```ts
// src/common/schedule/schedule-prompt.ts
import type { ScheduleTask } from "./schedule-types.js";

export const CONVERGED_MARKER = "CONVERGED";
/** An upstream reply is cut to this length before it goes into a prompt. */
export const MAX_REPLY_CHARS = 8_000;

const PLACEHOLDER = /\{\{\s*([a-z0-9-]{1,32})\.(reply|workspace)\s*\}\}/g;

const MARKER_INSTRUCTION =
  `When, and only when, the criteria above are met, end your reply with a line containing only ${CONVERGED_MARKER}. ` +
  `Until then, never end a reply with that line.`;
const MARKER_REMINDER = `End your reply with a line containing only ${CONVERGED_MARKER} once the stop criteria are met.`;

/** The `{{task.field}}` references in a prompt, in order. */
export function placeholdersIn(text: string): { task: string; field: "reply" | "workspace" }[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => ({ task: m[1]!, field: m[2] as "reply" | "workspace" }));
}

/**
 * Replace every reference with what `lookup` gives, or nothing. A reply longer
 * than MAX_REPLY_CHARS is cut, and the cut is stated so the reading agent knows.
 */
export function fillPlaceholders(
  text: string,
  lookup: (task: string, field: "reply" | "workspace") => string | undefined,
): string {
  return text.replace(PLACEHOLDER, (_m, task: string, field: "reply" | "workspace") => {
    const value = lookup(task, field) ?? "";
    if (field !== "reply" || value.length <= MAX_REPLY_CHARS) return value;
    return `${value.slice(0, MAX_REPLY_CHARS)}\n[reply cut to ${MAX_REPLY_CHARS} characters]`;
  });
}

/** The prompt a task starts with: its own text, then — when it loops — its stop criteria and the marker rule. */
export function firstPrompt(task: ScheduleTask, filled: string): string {
  if (!task.loop) return filled;
  return `${filled}\n\n## When to stop\n\n${task.loop.stopCriteria}\n\n${MARKER_INSTRUCTION}`;
}

/** What is pasted on every later iteration; a failed check's output is carried along. */
export function followUpPrompt(task: ScheduleTask, checkFailure?: { command: string; tail: string }): string {
  const parts = [task.loop?.followUp ?? ""];
  if (checkFailure) {
    parts.push(
      `You ended with ${CONVERGED_MARKER}, but the check \`${checkFailure.command}\` failed. The last lines of its output:\n\n\`\`\`\n${checkFailure.tail}\n\`\`\``,
    );
  }
  parts.push(MARKER_REMINDER);
  return parts.join("\n\n");
}

function lastLine(reply: string): string {
  const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/** True when the reply's last non-empty line is the marker, allowing `*`, `_` and backticks around it. */
export function hasConverged(reply: string): boolean {
  return lastLine(reply).replace(/[*_`]/g, "") === CONVERGED_MARKER;
}

/** The reply without its closing marker line, trimmed. */
export function stripMarker(reply: string): string {
  const trimmed = reply.trimEnd();
  if (!hasConverged(trimmed)) return trimmed;
  return trimmed.slice(0, trimmed.lastIndexOf("\n") + 1).trimEnd();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/common/schedule/schedule-prompt.test.ts`
Expected: PASS. (`stripMarker("CONVERGED")` alone returns `""` — `lastIndexOf` is -1, slice(0,0).)

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm run lint && pnpm run typecheck
git add src/common/schedule/schedule-prompt.ts src/common/schedule/schedule-prompt.test.ts
git commit -m "feat(schedule): prompt assembly, placeholders and the convergence marker"
```

### Task 3: Validation

**Files:**
- Create: `src/common/schedule/schedule-validate.ts`
- Test: `src/common/schedule/schedule-validate.test.ts`

**Interfaces:**
- Consumes: Task 1 types and graph helpers; `placeholdersIn` (Task 2).
- Produces: `validateSchedule(s: Schedule): ValidationProblem[]`.

- [ ] **Step 1: Write the failing tests (one per rule, AC-1, AC-2)**

```ts
// src/common/schedule/schedule-validate.test.ts
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
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/common/schedule/schedule-validate.test.ts`
Expected: FAIL — cannot resolve `./schedule-validate.js`.

- [ ] **Step 3: Implement**

```ts
// src/common/schedule/schedule-validate.ts
import {
  MAX_ITERATIONS,
  MAX_PROMPT_CHARS,
  MODEL_PATTERN,
  PERMISSION_MODES,
  SCHEDULE_HARNESSES,
  SCHEDULE_ID_PATTERN,
  type Schedule,
  type ScheduleTask,
  type ValidationProblem,
} from "./schedule-types.js";
import { findCycle, mayRunTogether, staticFolder, upstreamOf } from "./schedule-graph.js";
import { placeholdersIn } from "./schedule-prompt.js";

/**
 * Every problem that keeps a schedule from running, each naming the task and
 * field it concerns. A cycle stops the checks that walk the graph: with one
 * present, "upstream" has no meaning.
 */
export function validateSchedule(s: Schedule): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const add = (task: string | undefined, field: string, message: string): void => {
    problems.push(task === undefined ? { field, message } : { task, field, message });
  };
  if (!SCHEDULE_ID_PATTERN.test(s.id)) add(undefined, "id", "Use 1–32 lowercase letters, digits or dashes.");
  if (!s.name.trim()) add(undefined, "name", "Give the schedule a name.");
  if (s.tasks.length === 0) add(undefined, "tasks", "Add at least one task.");

  const seen = new Set<string>();
  for (const t of s.tasks) {
    if (!SCHEDULE_ID_PATTERN.test(t.id)) add(t.id, "id", "Use 1–32 lowercase letters, digits or dashes.");
    else if (seen.has(t.id)) add(t.id, "id", "Another task already uses this id.");
    seen.add(t.id);
  }
  for (const t of s.tasks) checkTask(t, seen, add);

  const cycle = findCycle(s);
  if (cycle) {
    add(cycle[0], "needs", `These tasks wait for each other: ${cycle.join(" → ")}.`);
    return problems;
  }
  for (const t of s.tasks) {
    const upstream = upstreamOf(s, t.id);
    if (t.workspace.kind === "sameAs" && seen.has(t.workspace.task) && !upstream.has(t.workspace.task)) {
      add(t.id, "workspace", `It can only share the workspace of a task it waits for.`);
    }
    const stray = placeholdersIn(t.prompt).filter((p) => !upstream.has(p.task));
    if (stray.length > 0) {
      add(t.id, "prompt", `Placeholders can only name tasks this one waits for: ${[...new Set(stray.map((p) => p.task))].join(", ")}.`);
    }
  }
  checkSharedFolders(s, add);
  return problems;
}

function checkTask(
  t: ScheduleTask,
  ids: Set<string>,
  add: (task: string, field: string, message: string) => void,
): void {
  const unknown = t.needs.filter((n) => !ids.has(n));
  if (unknown.length > 0) add(t.id, "needs", `Unknown tasks: ${unknown.join(", ")}.`);
  else if (t.needs.includes(t.id)) add(t.id, "needs", "A task cannot wait for itself.");
  if (t.workspace.kind === "sameAs" && !ids.has(t.workspace.task)) {
    add(t.id, "workspace", `Unknown task: ${t.workspace.task}.`);
  }
  if (!t.project.startsWith("/")) add(t.id, "project", "Pick a project folder.");
  if (!SCHEDULE_HARNESSES.includes(t.harness)) {
    add(t.id, "harness", `Unknown harness: ${String(t.harness)}.`);
    return;
  }
  if (t.permissionMode && !PERMISSION_MODES[t.harness].includes(t.permissionMode)) {
    add(t.id, "permissionMode", `${t.harness} offers: ${PERMISSION_MODES[t.harness].join(", ")}.`);
  }
  if (t.model && !MODEL_PATTERN.test(t.model)) add(t.id, "model", "Not a model name.");
  const prompt = t.prompt.trim();
  if (!prompt) add(t.id, "prompt", "Write the prompt.");
  else if (t.prompt.length > MAX_PROMPT_CHARS) add(t.id, "prompt", `Keep it under ${MAX_PROMPT_CHARS} characters.`);
  else if (prompt.startsWith("-")) add(t.id, "prompt", "It cannot start with “-”: the harness would read it as an option.");
  if (t.loop) {
    const { maxIterations, stopCriteria, followUp } = t.loop;
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
      add(t.id, "loop.maxIterations", `Between 1 and ${MAX_ITERATIONS}.`);
    }
    if (!stopCriteria.trim()) add(t.id, "loop.stopCriteria", "Say when the task is done.");
    if (!followUp.trim()) add(t.id, "loop.followUp", "Write what to send on each new iteration.");
  }
}

/** Tasks that may run together must not resolve to one folder: the wall tells sessions apart by folder. */
function checkSharedFolders(s: Schedule, add: (task: string, field: string, message: string) => void): void {
  const flagged = new Set<string>();
  for (let i = 0; i < s.tasks.length; i++) {
    for (let j = i + 1; j < s.tasks.length; j++) {
      const a = s.tasks[i]!;
      const b = s.tasks[j]!;
      if (flagged.has(b.id)) continue;
      if (staticFolder(s, a.id) !== staticFolder(s, b.id) || !mayRunTogether(s, a.id, b.id)) continue;
      add(b.id, "workspace", `It may run at the same time as “${a.name}” in the same folder. Give one a worktree, or make one wait for the other.`);
      flagged.add(b.id);
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/common/schedule/`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm run lint && pnpm run typecheck
git add src/common/schedule/schedule-validate.ts src/common/schedule/schedule-validate.test.ts
git commit -m "feat(schedule): validate schedules, including the shared-folder guard (AC-1, AC-2)"
```

### Task 4: Store

**Files:**
- Create: `src/node/schedule/schedule-store.ts`
- Test: `src/node/schedule/schedule-store.test.ts`

**Interfaces:**
- Consumes: `Schedule`, `RunState` (Task 1).
- Produces: `ScheduleFile { version: 1; schedules: Schedule[]; runs: Record<string, RunState> }`, `EMPTY_SCHEDULE_FILE`, `resolveSchedulesPath(env?)`, `loadSchedules(path?)`, `saveSchedules(file, path?)`.

- [ ] **Step 1: Write the failing tests (AC-3, Review Focus 3)**

```ts
// src/node/schedule/schedule-store.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadSchedules, resolveSchedulesPath, saveSchedules, type ScheduleFile } from "./schedule-store.js";

const dirs: string[] = [];
async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "spexr-schedules-"));
  dirs.push(dir);
  return join(dir, "nested", "schedules.json");
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

const file: ScheduleFile = {
  version: 1,
  schedules: [{ id: "s", name: "S", tasks: [] }],
  runs: {},
};

describe("resolveSchedulesPath", () => {
  it("prefers SPEXR_SCHEDULES", () => {
    expect(resolveSchedulesPath({ SPEXR_SCHEDULES: "/tmp/x.json" })).toBe("/tmp/x.json");
  });
  it("falls back to ~/.spexr/schedules.json", () => {
    expect(resolveSchedulesPath({})).toMatch(/\.spexr[/\\]schedules\.json$/);
  });
});

describe("loadSchedules / saveSchedules", () => {
  it("starts empty when there is no file", async () => {
    expect(await loadSchedules(await tempPath())).toEqual({ version: 1, schedules: [], runs: {} });
  });
  it("round-trips through an atomic write, leaving no temporary file", async () => {
    const path = await tempPath();
    await saveSchedules(file, path);
    expect(await loadSchedules(path)).toEqual(file);
    expect((await readdir(dirname(path))).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
  it("moves a damaged file aside instead of letting the next save erase it", async () => {
    const path = await tempPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "{ not json", "utf8");
    expect(await loadSchedules(path)).toEqual({ version: 1, schedules: [], runs: {} });
    const kept = (await readdir(dirname(path))).find((f) => f.startsWith("schedules.json.damaged-"));
    expect(kept).toBeDefined();
    expect(await readFile(join(dirname(path), kept!), "utf8")).toBe("{ not json");
  });
  it("treats a file of the wrong shape as damaged too", async () => {
    const path = await tempPath();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ version: 1, schedules: "nope" }), "utf8");
    expect((await loadSchedules(path)).schedules).toEqual([]);
    expect((await readdir(dirname(path))).some((f) => f.startsWith("schedules.json.damaged-"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-store.test.ts`
Expected: FAIL — cannot resolve `./schedule-store.js`.

- [ ] **Step 3: Implement**

```ts
// src/node/schedule/schedule-store.ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RunState, Schedule } from "../../common/schedule/schedule-types.js";

export interface ScheduleFile {
  version: 1;
  schedules: Schedule[];
  runs: Record<string, RunState>;
}

const empty = (): ScheduleFile => ({ version: 1, schedules: [], runs: {} });

/** `~/.spexr/schedules.json`, or `SPEXR_SCHEDULES` (tests). Global: the wall shows every project. */
export function resolveSchedulesPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["SPEXR_SCHEDULES"] ?? join(homedir(), ".spexr", "schedules.json");
}

function isScheduleFile(raw: unknown): raw is ScheduleFile {
  const f = raw as Partial<ScheduleFile> | null;
  return !!f && f.version === 1 && Array.isArray(f.schedules) && typeof f.runs === "object" && f.runs !== null;
}

/**
 * Load the file. Missing → empty. Unreadable or the wrong shape → moved aside
 * as `schedules.json.damaged-<ms>` and empty: starting empty and saving over it
 * would erase the operator's schedules for good.
 */
export async function loadSchedules(path: string = resolveSchedulesPath()): Promise<ScheduleFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return empty();
  }
  try {
    const raw: unknown = JSON.parse(text);
    if (isScheduleFile(raw)) return raw;
  } catch {
    /* fall through to setting it aside */
  }
  await rename(path, `${path}.damaged-${Date.now()}`).catch(() => undefined);
  return empty();
}

/** Write through a temporary file in the same folder, so a crash never leaves half a file. */
export async function saveSchedules(file: ScheduleFile, path: string = resolveSchedulesPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
  await rename(tmp, path);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
pnpm run lint && pnpm run typecheck
git add src/node/schedule/schedule-store.ts src/node/schedule/schedule-store.test.ts
git commit -m "feat(schedule): atomic schedule store that sets a damaged file aside (AC-3)"
```

**Slice 1 ends here.** All slices ship in one PR: https://github.com/sondalab-ai/spexr-ide/pull/66 — push to its branch and tick the slice in its description.

---

# Slice 2 — One task, end to end

### Task 5: Probes (manual, results recorded in the spec) — DONE 2026-09-27

Results are in the spec under **Risks → Probe results**; Tasks 8 and 11 were amended for them (startup dialog → *Needs you*; ptys clear Claude session markers).

No product code. Each probe answers a spec Risk; record each result under **Risks** in `docs/specs/0018-plant-schedule.md` with the date, and stop to re-plan if one fails.

- [ ] **Step 1: Claude session id and transcript location.** In a scratch folder:

```bash
cd "$(mktemp -d)" && U=$(uuidgen | tr A-Z a-z) && claude --session-id "$U" 'Reply with the word pong.'
# after it answers, quit it (/exit), then:
ls ~/.claude/projects/*/"$U".jsonl
```
Expected: exactly one path. Repeat with `CLAUDE_CONFIG_DIR=~/.claude-perso` exported (if that account exists) and confirm the file lands under `~/.claude-perso/projects/`.

Also record **startup dialogs**: in a fresh `mktemp -d` folder, does Claude ask to trust the folder before handling the prompt argument? And with `--permission-mode bypassPermissions`, does it ask for a first-use confirmation? For each dialog, note whether the transcript file exists *before* you answer it (`ls` from another terminal). If a dialog can come before the transcript, Slice 2 needs a "pty alive, no transcript yet" reading that shows *Needs you* instead of failing at 60 s — and every Slice 4 worktree (a new path each time) would hit the trust prompt. Add the finding to the spec's Risks and re-plan Task 8 before continuing.

- [ ] **Step 2: Backend pty with no window, and attaching later.** Temporarily add to `SpexrDarkfactoryBackendService` constructor path a throwaway call (do not commit): inject `IShellTerminalServer` in a scratch `BackendApplicationContribution` whose `onStart` runs `create({ args: ["-i", "-l", "-c", "sleep 300"], cols: 80, rows: 24 })` and logs the id and `getProcessId(id)`. Build, start SPEXR, close every window but keep the backend (or read the log before the window loads). Then, from the browser dev tools console of a window, confirm the wall's `reattach` path attaches: the easiest check is a scratch command calling `SpexrDarkfactoryTerminalManager.reattach("probe", { terminalId, processId }, "/tmp")` and opening the widget. Expected: no exception in the backend log when `create` runs with no client; the terminal shows `sleep` running. Revert the scratch code.

- [ ] **Step 3: Bracketed paste into an idle Claude TUI** (for Slice 3). In a Theia terminal running `claude`, after a reply, run in the backend scratch contribution `process.write("\x1b[200~line one\nline two\x1b[201~")` then, 100 ms later, `write("\r")`. Expected: one user message containing both lines. Try the same with `opencode`.

- [ ] **Step 4: Record and commit**

```bash
git add docs/specs/0018-plant-schedule.md
git commit -m "docs(spec): 0018 probe results"
```

### Task 6: Shared launch line

**Files:**
- Create: `src/common/harness/launch-line.ts`
- Test: `src/common/harness/launch-line.test.ts`
- Modify: `src/browser/darkfactory/darkfactory-terminal-manager.ts` (remove private `shellQuote` and `resolveShell` body; call the builder; add public `resolveLaunch`)

**Interfaces:**
- Consumes: `LaunchPlan`, `shellQuoteConfigDir` from `common/claude-launch-profiles.ts`.
- Produces: `shellQuote(arg: string): string`; `buildLaunchLine(o: { plan: LaunchPlan; args: string[]; cwd: string; ownsAccount: boolean; keepShell: boolean }): string`; `SpexrDarkfactoryTerminalManager.resolveLaunch(harness: HarnessId, configDir: string, projectPath: string): TaskLaunch`.

- [ ] **Step 1: Write tests that pin today's line (AC-4)**

These strings are what `resolveShell` produces today; write them against the current behaviour, not the new code.

```ts
// src/common/harness/launch-line.test.ts
import { describe, expect, it } from "vitest";
import { buildLaunchLine, shellQuote } from "./launch-line.js";

const claudePlan = { command: "claude", exportConfigDir: "", unquoted: true };

describe("buildLaunchLine", () => {
  it("unsets the account, cds, runs the harness and keeps a shell for the wall", () => {
    expect(
      buildLaunchLine({ plan: claudePlan, args: ["--resume", "abc"], cwd: "/repo", ownsAccount: true, keepShell: true }),
    ).toBe(`unset CLAUDE_CONFIG_DIR; cd '/repo'; claude '--resume' 'abc'; exec "$SHELL" -i`);
  });
  it("exports a home-relative account through $HOME and quotes a path command", () => {
    const plan = { command: "/opt/bin/claude", exportConfigDir: "~/.claude-perso", unquoted: false };
    expect(buildLaunchLine({ plan, args: [], cwd: "/r", ownsAccount: true, keepShell: true })).toBe(
      `export CLAUDE_CONFIG_DIR="$HOME"'/.claude-perso'; cd '/r'; '/opt/bin/claude'; exec "$SHELL" -i`,
    );
  });
  it("leaves the account alone for opencode", () => {
    const plan = { command: "opencode", exportConfigDir: "", unquoted: true };
    expect(buildLaunchLine({ plan, args: [], cwd: "/r", ownsAccount: false, keepShell: true })).toBe(
      `cd '/r'; opencode; exec "$SHELL" -i`,
    );
  });
  it("ends with the harness for a scheduled task, so its exit ends the pty", () => {
    expect(buildLaunchLine({ plan: claudePlan, args: ["hi"], cwd: "/r", ownsAccount: true, keepShell: false })).toBe(
      `unset CLAUDE_CONFIG_DIR; cd '/r'; claude 'hi'`,
    );
  });
  it("quotes a prompt carrying quotes and shell syntax", () => {
    const line = buildLaunchLine({ plan: claudePlan, args: [`it's $(rm -rf ~)`], cwd: "/r", ownsAccount: true, keepShell: false });
    expect(line.endsWith(`claude 'it'\\''s $(rm -rf ~)'`)).toBe(true);
  });
});

describe("shellQuote", () => {
  it("wraps in single quotes and escapes embedded ones", () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/common/harness/launch-line.test.ts`
Expected: FAIL — cannot resolve `./launch-line.js`.

- [ ] **Step 3: Implement the builder (moved verbatim from `resolveShell`)**

```ts
// src/common/harness/launch-line.ts
import { shellQuoteConfigDir, type LaunchPlan } from "../claude-launch-profiles.js";

/** Wrap an argument in single quotes for safe inclusion in a shell command. */
export function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * The `-c` line a login shell runs to start a harness (spec 0011 AC-8): the
 * account is exported or unset inside the line, then `cd`, then the harness
 * with every argument quoted. The command is quoted only when it is a path, so
 * a shell alias still expands. `keepShell` appends `exec "$SHELL" -i`, which
 * the wall wants (a failed resume stays readable) and a scheduled task must
 * not have (its harness exiting has to end the pty).
 */
export function buildLaunchLine(o: {
  plan: LaunchPlan;
  args: string[];
  cwd: string;
  ownsAccount: boolean;
  keepShell: boolean;
}): string {
  const account = o.plan.exportConfigDir
    ? `export CLAUDE_CONFIG_DIR=${shellQuoteConfigDir(o.plan.exportConfigDir)}`
    : "unset CLAUDE_CONFIG_DIR";
  const prefix = [o.ownsAccount ? account : "", o.cwd ? `cd ${shellQuote(o.cwd)}` : ""].filter(Boolean).join("; ");
  const bin = o.plan.unquoted ? o.plan.command : shellQuote(o.plan.command);
  const run = [bin, ...o.args.map(shellQuote)].join(" ");
  return `${prefix ? `${prefix}; ` : ""}${run}${o.keepShell ? `; exec "$SHELL" -i` : ""}`;
}
```

- [ ] **Step 4: Rewire the terminal manager**

In `src/browser/darkfactory/darkfactory-terminal-manager.ts`:
- delete the local `shellQuote` function (lines 29–32) and import `{ buildLaunchLine }` from `"../../common/harness/launch-line.js"`; drop `shellQuoteConfigDir` from the `claude-launch-profiles` import if nothing else uses it;
- replace the body of `resolveShell` with:

```ts
    const line = buildLaunchLine({ plan, args: resumeArgs, cwd: projectPath, ownsAccount, keepShell: true });
    return { shellArgs: ["-i", "-l", "-c", line] };
```
- add, below `terminalInfo`:

```ts
  /**
   * How a scheduled task must be launched, resolved here because the launch
   * profiles and the executable preference live in the frontend: the plan and
   * the account dir, exactly as a wall session with the same choices gets them.
   */
  resolveLaunch(harness: HarnessId, configDir: string, projectPath: string): TaskLaunch {
    const core = harness === "claude" ? claudeCore : opencodeCore;
    const dir = harness === "claude" ? this.resolveConfigDir(configDir, projectPath) : "";
    return { plan: this.launchPlan(core, dir, projectPath), configDir: dir };
  }
```
with `import type { TaskLaunch } from "../../common/schedule/schedule-types.js";` (check `claudeCore`/`opencodeCore` are the names already imported at the top; they are, lines 20–21).

- [ ] **Step 5: Verify**

Run: `npx vitest run --maxWorkers=2 src/common/harness/ src/browser/darkfactory/ && pnpm run lint && pnpm run typecheck`
Expected: PASS, no lint or type errors.

- [ ] **Step 6: Commit**

```bash
git add src/common/harness/launch-line.ts src/common/harness/launch-line.test.ts src/browser/darkfactory/darkfactory-terminal-manager.ts
git commit -m "refactor(darkfactory): one launch-line builder for the wall and scheduled tasks (AC-4)"
```

### Task 7: Turn tracking and the final reply

**Files:**
- Modify: `src/node/darkfactory/session-state.ts` (export `lastTurn`, its `Turn` type, `SETTLE_MS`, `AUTO_APPROVE_MODES`, `StateEntry`)
- Create: `src/node/schedule/turn-tracker.ts`
- Test: `src/node/schedule/turn-tracker.test.ts`

**Interfaces:**
- Consumes: `lastTurn(entries): Turn` where `Turn = "acting" | "permission" | "ended" | "unknown"`.
- Produces: `TurnSignal = { type: "turn-ended" } | { type: "needs-you" } | { type: "resumed-working" }`; `class TurnTracker { constructor(o: { permissionMode?: string; settleMs: number }); update(turn: Turn, nowMs: number): TurnSignal[] }`; `finalReply(entries: StateEntry[]): string`.

- [ ] **Step 1: Export from session-state**

In `src/node/darkfactory/session-state.ts` change `const SETTLE_MS`, `const AUTO_APPROVE_MODES`, `interface StateEntry`, `type Turn` and `function lastTurn` to `export`. No behaviour change.

- [ ] **Step 2: Write the failing tests (Review Focus 1 and 2)**

```ts
// src/node/schedule/turn-tracker.test.ts
import { describe, expect, it } from "vitest";
import { TurnTracker, finalReply } from "./turn-tracker.js";

describe("TurnTracker", () => {
  it("reports a turn end only after it has seen the agent working", () => {
    const t = new TurnTracker({ settleMs: 2_000 });
    expect(t.update("ended", 0)).toEqual([]); // nothing seen working yet: a stale end
    expect(t.update("acting", 1)).toEqual([]);
    expect(t.update("ended", 2)).toEqual([{ type: "turn-ended" }]);
  });
  it("does not report the same ended turn twice", () => {
    const t = new TurnTracker({ settleMs: 2_000 });
    t.update("acting", 0);
    t.update("ended", 1);
    expect(t.update("ended", 2)).toEqual([]);
    expect(t.update("ended", 3_000)).toEqual([]);
  });
  it("reports needs-you once a permission prompt has settled, and the resume after it", () => {
    const t = new TurnTracker({ settleMs: 2_000 });
    t.update("acting", 0);
    expect(t.update("permission", 1_000)).toEqual([]);
    expect(t.update("permission", 3_000)).toEqual([{ type: "needs-you" }]);
    expect(t.update("permission", 4_000)).toEqual([]);
    expect(t.update("acting", 5_000)).toEqual([{ type: "resumed-working" }]);
  });
  it("treats a pending tool as work under an auto-approving mode", () => {
    const t = new TurnTracker({ settleMs: 0, permissionMode: "bypassPermissions" });
    expect(t.update("permission", 0)).toEqual([]);
    expect(t.update("ended", 1)).toEqual([{ type: "turn-ended" }]);
  });
  it("closes a permission wait that ends the turn", () => {
    const t = new TurnTracker({ settleMs: 0 });
    expect(t.update("permission", 0)).toEqual([{ type: "needs-you" }]); // settleMs 0: confirmed at once
    expect(t.update("ended", 1)).toEqual([{ type: "resumed-working" }, { type: "turn-ended" }]);
  });
});

const user = (content: unknown) => ({ message: { role: "user", content } });
const assistant = (...content: unknown[]) => ({ message: { role: "assistant", content } });
const text = (t: string) => ({ type: "text", text: t });

describe("finalReply", () => {
  it("joins the whole last turn, across assistant entries and tool calls", () => {
    const entries = [
      user("first prompt"),
      assistant(text("old reply")),
      user("second prompt"),
      assistant(text("Looking."), { type: "tool_use", name: "Read", input: {} }),
      user([{ type: "tool_result", content: "file" }]),
      assistant(text("Fixed it.")),
      assistant(text("CONVERGED")),
    ];
    expect(finalReply(entries)).toBe("Looking.\n\nFixed it.\n\nCONVERGED");
  });
  it("ignores meta entries and returns empty without a reply", () => {
    expect(finalReply([user("p"), { isMeta: true, message: { role: "user", content: "x" } }])).toBe("");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/turn-tracker.test.ts`
Expected: FAIL — cannot resolve `./turn-tracker.js`.

- [ ] **Step 4: Implement**

```ts
// src/node/schedule/turn-tracker.ts
import { AUTO_APPROVE_MODES, type StateEntry, type Turn } from "../darkfactory/session-state.js";

export type TurnSignal = { type: "turn-ended" } | { type: "needs-you" } | { type: "resumed-working" };

/**
 * Turns a stream of turn readings into the transitions the schedule acts on.
 * A turn end counts only after the agent was seen working since the last one:
 * right after a paste the transcript still ends with the previous reply.
 * `settleMs` is how long a pending permission tool must sit before it counts
 * as a prompt (0 when the source already confirmed it, as the wall's tiles do).
 */
export class TurnTracker {
  private armed = false;
  private blocked = false;
  private permissionSince?: number;

  constructor(private readonly o: { permissionMode?: string; settleMs: number }) {}

  update(reading: Turn, nowMs: number): TurnSignal[] {
    const turn = reading === "permission" && AUTO_APPROVE_MODES.has(this.o.permissionMode ?? "") ? "acting" : reading;
    const out: TurnSignal[] = [];
    if (turn !== "permission") this.permissionSince = undefined;
    if (turn === "acting") {
      this.armed = true;
      if (this.blocked) {
        this.blocked = false;
        out.push({ type: "resumed-working" });
      }
    } else if (turn === "permission") {
      this.armed = true;
      this.permissionSince ??= nowMs;
      if (!this.blocked && nowMs - this.permissionSince >= this.o.settleMs) {
        this.blocked = true;
        out.push({ type: "needs-you" });
      }
    } else if (turn === "ended") {
      if (this.blocked) {
        this.blocked = false;
        out.push({ type: "resumed-working" });
      }
      if (this.armed) {
        this.armed = false;
        out.push({ type: "turn-ended" });
      }
    }
    return out;
  }
}

function isPrompt(e: StateEntry): boolean {
  if (e.isMeta || e.message?.role !== "user") return false;
  const c = e.message.content;
  if (typeof c === "string") return !c.trim().startsWith("[Request interrupted");
  return Array.isArray(c) && c.some((b) => (b as { type?: string })?.type === "text");
}

/** Every assistant text block after the last genuine prompt, joined: the whole final reply. */
export function finalReply(entries: StateEntry[]): string {
  let start = entries.length - 1;
  while (start >= 0 && !isPrompt(entries[start]!)) start--;
  const texts: string[] = [];
  for (const e of entries.slice(start + 1)) {
    if (e.isMeta || e.message?.role !== "assistant" || !Array.isArray(e.message.content)) continue;
    for (const b of e.message.content as { type?: string; text?: string }[]) {
      if (b?.type === "text" && typeof b.text === "string" && b.text.trim()) texts.push(b.text.trim());
    }
  }
  return texts.join("\n\n");
}
```

- [ ] **Step 5: Verify**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/turn-tracker.test.ts src/node/darkfactory/session-state.test.ts && pnpm run lint && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/node/darkfactory/session-state.ts src/node/schedule/turn-tracker.ts src/node/schedule/turn-tracker.test.ts
git commit -m "feat(schedule): turn tracker that counts each turn once, and the final reply"
```

### Task 8: Claude task watcher

**Files:**
- Create: `src/node/schedule/claude-task-watcher.ts`
- Test: `src/node/schedule/claude-task-watcher.test.ts`

**Interfaces:**
- Consumes: `readFollowChunk`, `FollowCursor` (`node/darkfactory/follow-reader.ts`); `projectsDirOf` (`node/darkfactory/config-dirs.ts`); `lastTurn`, `SETTLE_MS` (Task 7); `TurnTracker`, `finalReply` (Task 7).
- Produces: `WatchEvent = { type: "session-found"; sessionId: string } | { type: "session-missing" } | { type: "turn-ended"; reply: string } | { type: "needs-you" } | { type: "resumed-working" }`; `CLAUDE_STARTUP_PROMPT_MS = 8_000`; `everyMs(ms)`; `findClaudeTranscript(configDir, sessionId, home?): Promise<string | undefined>`; `watchClaudeTask(req, deps, listener): () => void`.

- [ ] **Step 1: Write the failing tests (Review Focus 4)**

```ts
// src/node/schedule/claude-task-watcher.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLAUDE_STARTUP_PROMPT_MS, findClaudeTranscript, watchClaudeTask, type WatchEvent } from "./claude-task-watcher.js";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function home(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "spexr-claude-watch-"));
  dirs.push(d);
  return d;
}

describe("findClaudeTranscript", () => {
  it("finds <id>.jsonl in any project folder of the account, default account included", async () => {
    const h = await home();
    await mkdir(join(h, ".claude", "projects", "-repo"), { recursive: true });
    await writeFile(join(h, ".claude", "projects", "-repo", "abc.jsonl"), "");
    expect(await findClaudeTranscript("", "abc", h)).toBe(join(h, ".claude", "projects", "-repo", "abc.jsonl"));
    expect(await findClaudeTranscript("~/.claude", "abc", h)).toBe(join(h, ".claude", "projects", "-repo", "abc.jsonl"));
    expect(await findClaudeTranscript("", "nope", h)).toBeUndefined();
  });
});

/** A manual clock and ticker: `tick()` runs one watcher iteration and waits for it. */
function harness(lines: () => string[] | undefined) {
  let now = 0;
  let tickFn: (() => Promise<void>) | undefined;
  const events: WatchEvent[] = [];
  const stop = watchClaudeTask(
    { sessionId: "abc", configDir: "" },
    {
      now: () => now,
      every: (fn) => {
        tickFn = fn;
        return () => (tickFn = undefined);
      },
      find: async () => (lines() ? "/t.jsonl" : undefined),
      read: async () => ({ lines: lines() ?? [], cursor: undefined }),
    },
    (e) => events.push(e),
  );
  return {
    events,
    stop,
    advance: async (ms: number) => {
      now += ms;
      await tickFn?.();
    },
    stopped: () => tickFn === undefined,
  };
}

const L = (o: unknown) => JSON.stringify(o);

describe("watchClaudeTask", () => {
  it("reports needs-you while no transcript exists (a startup dialog), once, and keeps waiting", async () => {
    let batch: string[] | undefined;
    const h = harness(() => batch);
    await h.advance(CLAUDE_STARTUP_PROMPT_MS - 1);
    expect(h.events).toEqual([]);
    await h.advance(2);
    expect(h.events).toEqual([{ type: "needs-you" }]);
    await h.advance(60_000);
    expect(h.events).toEqual([{ type: "needs-you" }]);
    expect(h.stopped()).toBe(false);
    batch = [L({ message: { role: "user", content: "p" } })];
    await h.advance(1_000);
    expect(h.events).toEqual([
      { type: "needs-you" },
      { type: "session-found", sessionId: "abc" },
      { type: "resumed-working" },
    ]);
  });

  it("reports the session, then a turn end with the whole reply", async () => {
    let batch: string[] | undefined;
    const h = harness(() => batch);
    batch = [L({ message: { role: "user", content: "p" } })];
    await h.advance(1_000);
    expect(h.events).toEqual([{ type: "session-found", sessionId: "abc" }]);
    batch = [L({ message: { role: "assistant", content: [{ type: "text", text: "done" }] } })];
    await h.advance(1_000);
    expect(h.events.at(-1)).toEqual({ type: "turn-ended", reply: "done" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/claude-task-watcher.test.ts`
Expected: FAIL — cannot resolve `./claude-task-watcher.js`.

- [ ] **Step 3: Implement**

```ts
// src/node/schedule/claude-task-watcher.ts
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFollowChunk, type FollowCursor } from "../darkfactory/follow-reader.js";
import { projectsDirOf } from "../darkfactory/config-dirs.js";
import { lastTurn, SETTLE_MS, type StateEntry } from "../darkfactory/session-state.js";
import { TurnTracker, finalReply, type TurnSignal } from "./turn-tracker.js";

/**
 * No transcript this long after launch: Claude is most likely at a startup
 * dialog (folder trust, bypass-mode confirmation), which it shows before it
 * writes anything (probe, 2026-09-27). The task then needs the operator.
 */
export const CLAUDE_STARTUP_PROMPT_MS = 8_000;
const TICK_MS = 1_000;
const FIRST_READ_BYTES = 4 * 1024 * 1024;
/** Entries kept in memory: enough for any one turn, bounded for long loops. */
const KEEP_ENTRIES = 2_000;

export type WatchEvent =
  | { type: "session-found"; sessionId: string }
  | { type: "session-missing" }
  | { type: "turn-ended"; reply: string }
  | Exclude<TurnSignal, { type: "turn-ended" }>;

/** The account dir as a path: "" is the default account, `~/…` is home-relative. */
function accountDir(configDir: string, home: string): string {
  if (!configDir) return join(home, ".claude");
  if (configDir === "~" || configDir === "$HOME") return home;
  if (configDir.startsWith("~/")) return join(home, configDir.slice(2));
  if (configDir.startsWith("$HOME/")) return join(home, configDir.slice(6));
  return configDir;
}

/** `<account>/projects/*\/<sessionId>.jsonl`, or undefined while it does not exist yet. */
export async function findClaudeTranscript(
  configDir: string,
  sessionId: string,
  home: string = homedir(),
): Promise<string | undefined> {
  const projects = projectsDirOf(accountDir(configDir, home));
  let dirs: string[];
  try {
    dirs = await readdir(projects);
  } catch {
    return undefined;
  }
  for (const d of dirs) {
    const candidate = join(projects, d, `${sessionId}.jsonl`);
    if (await stat(candidate).then((s) => s.isFile(), () => false)) return candidate;
  }
  return undefined;
}

export interface ClaudeWatchDeps {
  now(): number;
  /** Run `fn` every tick; returns a stop function. Ticks never overlap (the watcher awaits). */
  every(fn: () => Promise<void>): () => void;
  find(configDir: string, sessionId: string): Promise<string | undefined>;
  read(path: string, cursor: FollowCursor | undefined, tailBytes: number): ReturnType<typeof readFollowChunk>;
}

/** A ticker that runs `fn` every `ms`, skipping a tick while the previous one is still running. */
export function everyMs(ms: number): (fn: () => Promise<void>) => () => void {
  return (fn) => {
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void fn().finally(() => (busy = false));
    }, ms);
    timer.unref?.();
    return () => clearInterval(timer);
  };
}

export const defaultClaudeWatchDeps: ClaudeWatchDeps = {
  now: () => Date.now(),
  every: everyMs(TICK_MS),
  find: (configDir, sessionId) => findClaudeTranscript(configDir, sessionId),
  read: readFollowChunk,
};

/**
 * Follow one scheduled Claude session: wait for its transcript (reporting
 * needs-you after CLAUDE_STARTUP_PROMPT_MS — the pty exiting is what fails the
 * task), then read what it gains every second and report turn transitions.
 * Returns a stop function.
 */
export function watchClaudeTask(
  req: { sessionId: string; configDir: string; permissionMode?: string },
  deps: ClaudeWatchDeps,
  listener: (e: WatchEvent) => void,
): () => void {
  const startedAt = deps.now();
  const tracker = new TurnTracker({ permissionMode: req.permissionMode, settleMs: SETTLE_MS, armed: true });
  let path: string | undefined;
  let cursor: FollowCursor | undefined;
  let entries: StateEntry[] = [];
  let waitingAtStartup = false;
  let stop = (): void => {};
  stop = deps.every(async () => {
    if (!path) {
      path = await deps.find(req.configDir, req.sessionId);
      if (!path) {
        if (!waitingAtStartup && deps.now() - startedAt >= CLAUDE_STARTUP_PROMPT_MS) {
          waitingAtStartup = true;
          listener({ type: "needs-you" });
        }
        return;
      }
      listener({ type: "session-found", sessionId: req.sessionId });
      if (waitingAtStartup) listener({ type: "resumed-working" });
    }
    const chunk = await deps.read(path, cursor, FIRST_READ_BYTES);
    cursor = chunk.cursor;
    for (const line of chunk.lines) {
      try {
        entries.push(JSON.parse(line) as StateEntry);
      } catch {
        /* a torn line is skipped; the next read has the whole one */
      }
    }
    if (entries.length > KEEP_ENTRIES) entries = entries.slice(-KEEP_ENTRIES);
    for (const signal of tracker.update(lastTurn(entries), deps.now())) {
      listener(signal.type === "turn-ended" ? { type: "turn-ended", reply: finalReply(entries) } : signal);
    }
  });
  return () => stop();
}
```

Note: the test's `every` returns a stop that clears `tickFn`; `stop()` inside the tick uses the same function.

- [ ] **Step 4: Verify**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/claude-task-watcher.test.ts && pnpm run lint && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/node/schedule/claude-task-watcher.ts src/node/schedule/claude-task-watcher.test.ts
git commit -m "feat(schedule): follow a Claude task's transcript; a startup dialog shows as Needs you"
```

### Task 9: opencode task watcher over the wall's scans

**Files:**
- Modify: `src/node/darkfactory/spexr-darkfactory-backend-service.ts` (scan announcements)
- Create: `src/node/schedule/opencode-task-watcher.ts`
- Test: `src/node/schedule/opencode-task-watcher.test.ts`

**Interfaces:**
- Consumes: `AgentTile` (`common/darkfactory-protocol.ts`); `TurnTracker`, `finalReply` (Task 7); `WatchEvent` (Task 8).
- Produces: on `SpexrDarkfactoryBackendService`: `onScanned(listener: (tiles: AgentTile[]) => void): () => void`, `requestScan(): void`, `knownSessionIds(): Set<string>`, `scanEntries(sessionId: string): Promise<unknown[]>`. The interface `WallScanSource` with exactly those four members; `OPENCODE_SESSION_WAIT_MS = 120_000`; `SCAN_EVERY_MS = 20_000`; `watchOpencodeTask(req, source, deps, listener): () => void`.

- [ ] **Step 1: Add scan announcements to the Dark Factory backend**

In `spexr-darkfactory-backend-service.ts`:
- import `{ Emitter } from "@theia/core/lib/common/event"`;
- add fields `private readonly scanned = new Emitter<AgentTile[]>();`;
- at the end of `listTiles()`, just before its `return`, fire `this.scanned.fire(tiles)` with the array it returns (assign it to a `const tiles` first if it is returned inline);
- add the public members:

```ts
  /** Each finished scan's tiles, for backend consumers (the plant schedule's opencode tasks). */
  onScanned(listener: (tiles: AgentTile[]) => void): () => void {
    const d = this.scanned.event(listener);
    return () => d.dispose();
  }

  /** Scan now, for a consumer that needs fresh tiles while no window is asking. */
  requestScan(): void {
    void this.listTiles().catch(() => undefined);
  }

  /** Session ids the last scan knew. */
  knownSessionIds(): Set<string> {
    return new Set(this.index.keys());
  }

  /** A scanned session's entries through the loader the scan kept; [] when unknown. */
  async scanEntries(sessionId: string): Promise<unknown[]> {
    return (await this.meta(sessionId)?.loadEntries?.().catch(() => [])) ?? [];
  }
```
(check `this.index` is the `Map<string, SessionMeta>` `meta()` reads first; it is, line 431.)

Run `npx vitest run --maxWorkers=2 src/node/darkfactory/` — expected PASS (no behaviour change).

- [ ] **Step 2: Write the failing watcher tests**

```ts
// src/node/schedule/opencode-task-watcher.test.ts
import { describe, expect, it } from "vitest";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { OPENCODE_SESSION_WAIT_MS, watchOpencodeTask, type WallScanSource } from "./opencode-task-watcher.js";
import type { WatchEvent } from "./claude-task-watcher.js";

function tile(sessionId: string, projectPath: string, o: Partial<AgentTile>): AgentTile {
  return { sessionId, projectPath, harness: "opencode", state: "working", needsYou: false, needsYouCertain: false, ...o } as AgentTile;
}

function source() {
  let emit: (t: AgentTile[]) => void = () => {};
  let scans = 0;
  const s: WallScanSource = {
    onScanned: (l) => ((emit = l), () => (emit = () => {})),
    requestScan: () => void (scans += 1),
    knownSessionIds: () => new Set(["old"]),
    scanEntries: async () => [
      { message: { role: "user", content: "p" } },
      { message: { role: "assistant", content: [{ type: "text", text: "all set" }] } },
    ],
  };
  return { s, emit: (t: AgentTile[]) => emit(t), scans: () => scans };
}

describe("watchOpencodeTask", () => {
  it("adopts the first unknown session in its folder and reports its turn end", async () => {
    const src = source();
    let now = 0;
    const events: WatchEvent[] = [];
    watchOpencodeTask({ workspace: "/repo" }, src.s, { now: () => now, every: () => () => {} }, (e) => events.push(e));
    src.emit([tile("old", "/repo", {}), tile("other", "/elsewhere", {}), tile("new", "/repo/", {})]);
    expect(events).toEqual([{ type: "session-found", sessionId: "new" }]);
    src.emit([tile("new", "/repo", { state: "idle", needsYou: true })]);
    await new Promise((r) => setTimeout(r, 0));
    expect(events.at(-1)).toEqual({ type: "turn-ended", reply: "all set" });
  });

  it("asks for scans on its own clock and gives up after the wait", () => {
    const src = source();
    let now = 0;
    let tick: () => void = () => {};
    const events: WatchEvent[] = [];
    watchOpencodeTask(
      { workspace: "/repo" },
      src.s,
      { now: () => now, every: (fn) => ((tick = () => void fn()), () => (tick = () => {})) },
      (e) => events.push(e),
    );
    tick();
    expect(src.scans()).toBe(1);
    now = OPENCODE_SESSION_WAIT_MS + 1;
    src.emit([]);
    expect(events).toEqual([{ type: "session-missing" }]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/opencode-task-watcher.test.ts`
Expected: FAIL — cannot resolve `./opencode-task-watcher.js`.

- [ ] **Step 4: Implement**

```ts
// src/node/schedule/opencode-task-watcher.ts
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import type { Turn, StateEntry } from "../darkfactory/session-state.js";
import { TurnTracker, finalReply } from "./turn-tracker.js";
import type { WatchEvent } from "./claude-task-watcher.js";

export const OPENCODE_SESSION_WAIT_MS = 120_000;
/** The wall's own poll interval: asking more often would re-run `opencode db` (see its memory note). */
export const SCAN_EVERY_MS = 20_000;

/** What the runner needs from the Dark Factory backend: its scans, not its own `opencode db` queries. */
export interface WallScanSource {
  onScanned(listener: (tiles: AgentTile[]) => void): () => void;
  requestScan(): void;
  knownSessionIds(): Set<string>;
  scanEntries(sessionId: string): Promise<unknown[]>;
}

const norm = (p: string): string => p.replace(/\/+$/, "") || p;

/** A tile's state as a turn reading: the wall already settled permission prompts. */
function turnOf(t: AgentTile): Turn {
  if (t.state === "working") return "acting";
  if (t.needsYouCertain) return "permission";
  if (t.needsYou) return "ended";
  return "unknown";
}

/**
 * Watch an opencode task through the wall's scans: adopt the first session in
 * its folder that the wall did not know at launch, then report its turn
 * transitions. Asks for a scan every SCAN_EVERY_MS so it moves with no window open.
 */
export function watchOpencodeTask(
  req: { workspace: string; permissionMode?: string },
  source: WallScanSource,
  deps: { now(): number; every(fn: () => Promise<void>): () => void },
  listener: (e: WatchEvent) => void,
): () => void {
  const known = source.knownSessionIds();
  const startedAt = deps.now();
  const tracker = new TurnTracker({ permissionMode: req.permissionMode, settleMs: 0, armed: true });
  let sessionId: string | undefined;
  let stopped = false;
  const stopScans = deps.every(async () => source.requestScan());
  const stopListening = source.onScanned((tiles) => {
    if (stopped) return;
    if (!sessionId) {
      const found = tiles.find((t) => t.harness === "opencode" && norm(t.projectPath) === norm(req.workspace) && !known.has(t.sessionId));
      if (!found) {
        if (deps.now() - startedAt >= OPENCODE_SESSION_WAIT_MS) {
          stop();
          listener({ type: "session-missing" });
        }
        return;
      }
      sessionId = found.sessionId;
      listener({ type: "session-found", sessionId });
    }
    const mine = tiles.find((t) => t.sessionId === sessionId);
    if (!mine) return;
    for (const signal of tracker.update(turnOf(mine), deps.now())) {
      if (signal.type !== "turn-ended") listener(signal);
      else
        void source
          .scanEntries(sessionId)
          .then((entries) => listener({ type: "turn-ended", reply: finalReply(entries as StateEntry[]) }));
    }
  });
  function stop(): void {
    stopped = true;
    stopScans();
    stopListening();
  }
  return stop;
}
```

In production the service passes `every: everyMs(SCAN_EVERY_MS)` (`everyMs` is exported by `claude-task-watcher.ts`, Task 8); export `SCAN_EVERY_MS` so the service uses the same value.

- [ ] **Step 5: Verify**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/ src/node/darkfactory/ && pnpm run lint && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/node/darkfactory/spexr-darkfactory-backend-service.ts src/node/schedule/opencode-task-watcher.ts src/node/schedule/opencode-task-watcher.test.ts src/node/schedule/claude-task-watcher.ts
git commit -m "feat(schedule): watch opencode tasks through the wall's scans, no extra db queries (AC-6)"
```

### Task 10: Task arguments and the engine (Slice 2 events)

**Files:**
- Create: `src/common/schedule/task-args.ts`
- Test: `src/common/schedule/task-args.test.ts`
- Create: `src/node/schedule/schedule-engine.ts`
- Test: `src/node/schedule/schedule-engine.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `firstPrompt`, `fillPlaceholders`, `stripMarker` (Task 2).
- Produces: `buildTaskArgs(task: ScheduleTask, prompt: string, sessionId?: string): string[]`; `EngineEvent`, `Effect`, `StepResult`, `startRun(schedule, launches, runId, nowMs): StepResult`, `step(schedule, run, event): StepResult`, `sessionName(schedule, taskId, iteration): string`.

- [ ] **Step 1: Failing tests for arguments**

```ts
// src/common/schedule/task-args.test.ts
import { describe, expect, it } from "vitest";
import type { ScheduleTask } from "./schedule-types.js";
import { buildTaskArgs } from "./task-args.js";

const t = (o: Partial<ScheduleTask>): ScheduleTask => ({
  id: "t", name: "T", needs: [], project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p", ...o,
});

describe("buildTaskArgs", () => {
  it("claude: session id, model, permission mode, then the prompt last", () => {
    expect(buildTaskArgs(t({ model: "sonnet", permissionMode: "acceptEdits" }), "Go.", "u-1")).toEqual([
      "--session-id", "u-1", "--model", "sonnet", "--permission-mode", "acceptEdits", "Go.",
    ]);
  });
  it("opencode: model, --auto, --prompt", () => {
    expect(buildTaskArgs(t({ harness: "opencode", model: "a/b", permissionMode: "auto" }), "Go.")).toEqual([
      "-m", "a/b", "--auto", "--prompt", "Go.",
    ]);
  });
  it("claude without a session id is a programming error", () => {
    expect(() => buildTaskArgs(t({}), "Go.")).toThrow();
  });
});
```

- [ ] **Step 2: Implement arguments**

```ts
// src/common/schedule/task-args.ts
import type { ScheduleTask } from "./schedule-types.js";

/** Harness arguments for a task's first launch; the prompt is always last. */
export function buildTaskArgs(task: ScheduleTask, prompt: string, sessionId?: string): string[] {
  if (task.harness === "claude") {
    if (!sessionId) throw new Error("A Claude task is launched with the session id the runner chose.");
    return [
      "--session-id", sessionId,
      ...(task.model ? ["--model", task.model] : []),
      ...(task.permissionMode ? ["--permission-mode", task.permissionMode] : []),
      prompt,
    ];
  }
  return [
    ...(task.model ? ["-m", task.model] : []),
    ...(task.permissionMode === "auto" ? ["--auto"] : []),
    "--prompt", prompt,
  ];
}
```

Run: `npx vitest run --maxWorkers=2 src/common/schedule/task-args.test.ts` — expected PASS.

- [ ] **Step 3: Failing engine tests**

```ts
// src/node/schedule/schedule-engine.test.ts
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
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-engine.test.ts`
Expected: FAIL — cannot resolve `./schedule-engine.js`.

- [ ] **Step 5: Implement the engine**

```ts
// src/node/schedule/schedule-engine.ts
import {
  ACTIVE_STATUSES,
  SETTLED_STATUSES,
  type RunState,
  type Schedule,
  type ScheduleTask,
  type TaskLaunch,
} from "../../common/schedule/schedule-types.js";
import { fillPlaceholders, firstPrompt, stripMarker } from "../../common/schedule/schedule-prompt.js";

export type EngineEvent =
  | { type: "started"; task: string; terminalId: number; processId: number; workspace: string; sessionId?: string }
  | { type: "start-failed"; task: string; error: string }
  | { type: "session-found"; task: string; sessionId: string }
  | { type: "session-missing"; task: string }
  | { type: "turn-ended"; task: string; reply: string }
  | { type: "needs-you"; task: string }
  | { type: "resumed-working"; task: string }
  | { type: "exited"; task: string }
  | { type: "abort" }
  | { type: "recover" };

export type Effect =
  | { type: "start"; task: string; prompt: string }
  | { type: "name"; sessionId: string; name: string };

export interface StepResult {
  run: RunState;
  effects: Effect[];
}

/** The wall card's label for a task: `<schedule> · <task> (<iteration>/<max>)`. */
export function sessionName(schedule: Schedule, taskId: string, iteration: number): string {
  const t = schedule.tasks.find((x) => x.id === taskId);
  return `${schedule.name} · ${t?.name ?? taskId} (${iteration}/${t?.loop?.maxIterations ?? 1})`;
}

/** A new run with every task pending, and the first ready tasks started. */
export function startRun(schedule: Schedule, launches: Record<string, TaskLaunch>, runId: string, nowMs: number): StepResult {
  const run: RunState = {
    scheduleId: schedule.id,
    runId,
    status: "running",
    startedAtMs: nowMs,
    tasks: Object.fromEntries(schedule.tasks.map((t) => [t.id, { status: "pending" as const, iteration: 0 }])),
    launches,
  };
  const effects: Effect[] = [];
  advance(schedule, run, effects);
  return { run, effects };
}

/**
 * Apply one event to a run: pure, never mutates its input. Returns the new run
 * and the effects the runner must perform. Events for a task in a state they
 * do not apply to are ignored, so a late watcher signal cannot resurrect a task.
 */
export function step(schedule: Schedule, prev: RunState, event: EngineEvent): StepResult {
  const run = structuredClone(prev);
  const effects: Effect[] = [];
  if (run.status !== "running") return { run, effects };
  const task = "task" in event ? run.tasks[event.task] : undefined;
  switch (event.type) {
    case "started":
      if (task?.status !== "starting") break;
      Object.assign(task, {
        status: "running",
        terminalId: event.terminalId,
        processId: event.processId,
        workspace: event.workspace,
      });
      // Claude's id is chosen before launch: recording it now lets a window
      // recognise the task's card from its first second (no duplicate card).
      if (event.sessionId) task.sessionId = event.sessionId;
      break;
    case "session-found":
      if (!task || !ACTIVE_STATUSES.has(task.status)) break;
      task.sessionId = event.sessionId;
      effects.push({ type: "name", sessionId: event.sessionId, name: sessionName(schedule, event.task, task.iteration) });
      break;
    case "start-failed":
      if (task?.status === "starting") fail(run, event.task, event.error);
      break;
    case "session-missing":
      if (task && ACTIVE_STATUSES.has(task.status)) fail(run, event.task, "The session's transcript never appeared.");
      break;
    case "exited":
      if (task && ACTIVE_STATUSES.has(task.status)) fail(run, event.task, "The session ended before the task converged.");
      break;
    case "turn-ended":
      if (task?.status !== "running" && task?.status !== "waiting-on-you") break;
      task.reply = event.reply;
      task.status = "converged";
      break;
    case "needs-you":
      if (task?.status === "running") task.status = "waiting-on-you";
      break;
    case "resumed-working":
      if (task?.status === "waiting-on-you") task.status = "running";
      break;
    case "abort":
      run.status = "aborted";
      return { run, effects };
    case "recover":
      for (const t of Object.values(run.tasks)) if (ACTIVE_STATUSES.has(t.status)) t.status = "interrupted";
      if (Object.values(run.tasks).some((t) => t.status === "interrupted")) run.pausedBy = "failure";
      return { run, effects };
  }
  advance(schedule, run, effects);
  return { run, effects };
}

function fail(run: RunState, taskId: string, error: string): void {
  const t = run.tasks[taskId]!;
  t.status = "failed";
  t.error = error;
  run.pausedBy = "failure";
}

function ready(schedule: Schedule, run: RunState): ScheduleTask[] {
  return schedule.tasks.filter(
    (t) => run.tasks[t.id]?.status === "pending" && t.needs.every((n) => SETTLED_STATUSES.has(run.tasks[n]?.status ?? "pending")),
  );
}

/** Start what is ready (unless paused) and finish the run once everything has settled. */
function advance(schedule: Schedule, run: RunState, effects: Effect[]): void {
  if (!run.pausedBy) {
    for (const t of ready(schedule, run)) {
      run.tasks[t.id] = { status: "starting", iteration: 1 };
      const filled = fillPlaceholders(t.prompt, (id, field) =>
        field === "reply" ? stripMarker(run.tasks[id]?.reply ?? "") : run.tasks[id]?.workspace,
      );
      effects.push({ type: "start", task: t.id, prompt: firstPrompt(t, filled) });
    }
  }
  if (schedule.tasks.every((t) => SETTLED_STATUSES.has(run.tasks[t.id]?.status ?? "pending"))) run.status = "finished";
}
```

- [ ] **Step 6: Verify**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/ src/common/schedule/ && pnpm run lint && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/common/schedule/task-args.ts src/common/schedule/task-args.test.ts src/node/schedule/schedule-engine.ts src/node/schedule/schedule-engine.test.ts
git commit -m "feat(schedule): task arguments and the run state machine for single turns (AC-7)"
```

### Task 11: Runner, backend pty and RPC service

**Files:**
- Create: `src/common/schedule/schedule-protocol.ts`
- Create: `src/node/schedule/schedule-pty.ts`
- Create: `src/node/schedule/schedule-runner.ts`
- Test: `src/node/schedule/schedule-runner.test.ts`
- Create: `src/node/schedule/spexr-schedule-backend-service.ts`
- Modify: `src/node/spexr-backend-module.ts`

**Interfaces:**
- Consumes: store (Task 4), engine (Task 10), `buildLaunchLine` (Task 6), `buildTaskArgs` (Task 10), watchers (Tasks 8–9), `validateSchedule` (Task 3), `SpexrDarkfactoryBackendService.renameSession(sessionId, name)` (existing, line 825).
- Produces:

```ts
// src/common/schedule/schedule-protocol.ts
import type { RunState, Schedule, TaskLaunch, ValidationProblem } from "./schedule-types.js";

export const SCHEDULE_SERVICE_PATH = "/services/spexr/schedules";

export interface ScheduleSnapshot {
  schedules: Schedule[];
  runs: Record<string, RunState>;
}

/** Frontend → backend. Runs live in the backend; a window reload loses nothing. */
export interface SpexrScheduleService {
  snapshot(): Promise<ScheduleSnapshot>;
  /** Saved even when invalid; the problems say why it cannot run. */
  save(schedule: Schedule): Promise<ValidationProblem[]>;
  remove(scheduleId: string): Promise<void>;
  /** Starts a run; returns the problems instead when the schedule cannot run. */
  run(scheduleId: string, launches: Record<string, TaskLaunch>): Promise<ValidationProblem[]>;
  abort(scheduleId: string): Promise<void>;
}

/** Backend → frontend (reaches the most recently opened window, like the wall). */
export interface SpexrScheduleClient {
  onSnapshot(snapshot: ScheduleSnapshot): void;
}
```

- [ ] **Step 1: The pty port**

```ts
// src/node/schedule/schedule-pty.ts
import { inject, injectable } from "@theia/core/shared/inversify";
import { IShellTerminalServer } from "@theia/terminal/lib/common/shell-terminal-protocol";
import { ProcessManager } from "@theia/process/lib/node/process-manager";
import { TerminalProcess } from "@theia/process/lib/node/terminal-process";

/**
 * The terminal server merges the backend's environment into every pty. A SPEXR
 * started from inside a Claude Code session carries that session's markers, and
 * a Claude started with `CLAUDE_CODE_CHILD_SESSION` saves no transcript (probe,
 * 2026-09-27). A null value removes a variable in Theia's env merge.
 */
export function withoutClaudeSessionMarkers(env: NodeJS.ProcessEnv): Record<string, null> {
  const cleared: Record<string, null> = {};
  for (const key of Object.keys(env)) if (key === "CLAUDECODE" || key.startsWith("CLAUDE_CODE_")) cleared[key] = null;
  return cleared;
}

/**
 * Backend ptys for scheduled tasks, through the same terminal server the
 * frontend's terminals use: a window attaches to one by its terminal id.
 */
@injectable()
export class SchedulePty {
  @inject(IShellTerminalServer) private readonly terminals!: IShellTerminalServer;
  @inject(ProcessManager) private readonly processes!: ProcessManager;

  async launch(line: string, cwd: string): Promise<{ terminalId: number; processId: number }> {
    const terminalId = await this.terminals.create({
      args: ["-i", "-l", "-c", line],
      rootURI: `file://${cwd}`,
      cols: 120,
      rows: 40,
      env: withoutClaudeSessionMarkers(process.env),
    });
    if (terminalId < 0) throw new Error("The terminal server could not start the session.");
    return { terminalId, processId: await this.terminals.getProcessId(terminalId) };
  }

  write(terminalId: number, data: string): void {
    const p = this.processes.get(terminalId);
    if (p instanceof TerminalProcess) p.write(data);
  }

  /** Calls `listener` once the pty exits (at once when it is already gone). Returns an unsubscribe. */
  onExit(terminalId: number, listener: () => void): () => void {
    const p = this.processes.get(terminalId);
    if (!p) {
      queueMicrotask(listener);
      return () => {};
    }
    const d = p.onExit(() => listener());
    return () => d.dispose();
  }
}
```

Add `src/node/schedule/schedule-pty.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withoutClaudeSessionMarkers } from "./schedule-pty.js";

describe("withoutClaudeSessionMarkers", () => {
  it("clears CLAUDECODE and CLAUDE_CODE_* but keeps the account", () => {
    expect(
      withoutClaudeSessionMarkers({ CLAUDECODE: "1", CLAUDE_CODE_CHILD_SESSION: "x", CLAUDE_CONFIG_DIR: "/a", PATH: "/bin" }),
    ).toEqual({ CLAUDECODE: null, CLAUDE_CODE_CHILD_SESSION: null });
  });
});
```

(If importing `schedule-pty.ts` in vitest fails on Theia's decorators or module loading, move `withoutClaudeSessionMarkers` to `src/node/schedule/pty-env.ts` and import it from both.)

- [ ] **Step 2: Failing runner tests (fake ports)**

```ts
// src/node/schedule/schedule-runner.test.ts
import { describe, expect, it } from "vitest";
import type { Schedule, TaskLaunch } from "../../common/schedule/schedule-types.js";
import { ScheduleRunner, type RunnerPorts } from "./schedule-runner.js";
import type { WatchEvent } from "./claude-task-watcher.js";
import type { ScheduleFile } from "./schedule-store.js";

const launch: TaskLaunch = { plan: { command: "claude", exportConfigDir: "", unquoted: true }, configDir: "" };
const schedule: Schedule = {
  id: "s",
  name: "S",
  tasks: [{ id: "a", name: "A", needs: [], project: "/repo", workspace: { kind: "folder" }, harness: "claude", prompt: "Go." }],
};

function fakes() {
  const lines: string[] = [];
  const names: [string, string][] = [];
  let watch: ((e: WatchEvent) => void) | undefined;
  let exit: (() => void) | undefined;
  let saved: ScheduleFile | undefined;
  const ports: RunnerPorts = {
    launch: async (line) => (lines.push(line), { terminalId: 3, processId: 30 }),
    onExit: (_id, l) => ((exit = l), () => (exit = undefined)),
    watchClaude: (_req, l) => ((watch = l), () => (watch = undefined)),
    watchOpencode: () => () => {},
    rename: async (id, name) => void names.push([id, name]),
    newSessionId: () => "u-1",
    now: () => 1,
    save: async (f) => void (saved = structuredClone(f)),
    publish: () => {},
  };
  return { ports, lines, names, emit: (e: WatchEvent) => watch!(e), exit: () => exit!(), saved: () => saved, watching: () => !!watch };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

describe("ScheduleRunner", () => {
  it("launches a Claude task with its session id and prompt, and converges on its turn end", async () => {
    const f = fakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    expect(await runner.run("s", { a: launch })).toEqual([]);
    await settle();
    expect(f.lines).toEqual([`unset CLAUDE_CONFIG_DIR; cd '/repo'; claude '--session-id' 'u-1' 'Go.'`]);
    f.emit({ type: "session-found", sessionId: "u-1" });
    await settle();
    expect(f.names).toEqual([["u-1", "S · A (1/1)"]]);
    f.emit({ type: "turn-ended", reply: "ok" });
    await settle();
    expect(f.saved()!.runs["s"]!.status).toBe("finished");
    expect(f.watching()).toBe(false); // watcher released once the task settled
  });

  it("refuses to run an invalid schedule or one already running", async () => {
    const f = fakes();
    const bad = { ...schedule, tasks: [{ ...schedule.tasks[0]!, prompt: "" }] };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [bad], runs: {} });
    expect((await runner.run("s", { a: launch })).length).toBeGreaterThan(0);
    const ok = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await ok.run("s", { a: launch });
    expect(await ok.run("s", { a: launch })).toEqual([{ field: "run", message: "This schedule is already running." }]);
  });

  it("fails the task when the pty exits first", async () => {
    const f = fakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    f.exit();
    await settle();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("failed");
  });

  it("marks tasks interrupted when it starts over a run left running (AC-16)", async () => {
    const f = fakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    const restarted = new ScheduleRunner(f.ports, f.saved()!);
    await restarted.recover();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("interrupted");
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-runner.test.ts`
Expected: FAIL — cannot resolve `./schedule-runner.js`.

- [ ] **Step 4: Implement the runner**

```ts
// src/node/schedule/schedule-runner.ts
import { randomUUID } from "node:crypto";
import {
  ACTIVE_STATUSES,
  type RunState,
  type Schedule,
  type TaskLaunch,
  type ValidationProblem,
} from "../../common/schedule/schedule-types.js";
import { validateSchedule } from "../../common/schedule/schedule-validate.js";
import { buildLaunchLine } from "../../common/harness/launch-line.js";
import { buildTaskArgs } from "../../common/schedule/task-args.js";
import { startRun, step, type Effect, type EngineEvent } from "./schedule-engine.js";
import type { ScheduleFile } from "./schedule-store.js";
import type { WatchEvent } from "./claude-task-watcher.js";

/** Everything the runner does to the outside world; injected so every rule is testable. */
export interface RunnerPorts {
  launch(line: string, cwd: string): Promise<{ terminalId: number; processId: number }>;
  onExit(terminalId: number, listener: () => void): () => void;
  watchClaude(req: { sessionId: string; configDir: string; permissionMode?: string }, listener: (e: WatchEvent) => void): () => void;
  watchOpencode(req: { workspace: string; permissionMode?: string }, listener: (e: WatchEvent) => void): () => void;
  rename(sessionId: string, name: string): Promise<void>;
  newSessionId(): string;
  now(): number;
  save(file: ScheduleFile): Promise<void>;
  publish(file: ScheduleFile): void;
}

/**
 * Owns the schedule file in memory and drives runs: each event goes through
 * the pure engine, the result is saved and published, then its effects run.
 * Events are applied one at a time, in order, per runner.
 */
export class ScheduleRunner {
  private queue: Promise<void> = Promise.resolve();
  private readonly releases = new Map<string, (() => void)[]>();

  constructor(
    private readonly ports: RunnerPorts,
    private file: ScheduleFile,
  ) {}

  get current(): ScheduleFile {
    return this.file;
  }

  /** Replace the schedules (save/remove); runs are left alone. */
  async setSchedules(schedules: Schedule[]): Promise<void> {
    await this.serial(async () => {
      this.file = { ...this.file, schedules };
      await this.persist();
    });
  }

  async run(scheduleId: string, launches: Record<string, TaskLaunch>): Promise<ValidationProblem[]> {
    const schedule = this.schedule(scheduleId);
    if (!schedule) return [{ field: "id", message: "Unknown schedule." }];
    const problems = validateSchedule(schedule);
    if (problems.length > 0) return problems;
    if (schedule.tasks.some((t) => t.workspace.kind === "worktree")) {
      return [{ field: "workspace", message: "Worktree workspaces arrive with the full graph (Slice 4)." }];
    }
    if (schedule.tasks.some((t) => !launches[t.id]?.plan.command.trim() || /[\n\r]/.test(launches[t.id]!.plan.command))) {
      return [{ field: "run", message: "A task has no usable launch command." }];
    }
    if (this.file.runs[scheduleId]?.status === "running") return [{ field: "run", message: "This schedule is already running." }];
    await this.serial(async () => {
      const { run, effects } = startRun(schedule, launches, randomUUID(), this.ports.now());
      await this.commit(scheduleId, run, effects);
    });
    return [];
  }

  abort(scheduleId: string): Promise<void> {
    return this.dispatch(scheduleId, { type: "abort" });
  }

  /** On backend start: tasks that were running when the app went away are interrupted. */
  async recover(): Promise<void> {
    for (const id of Object.keys(this.file.runs)) await this.dispatch(id, { type: "recover" });
  }

  dispatch(scheduleId: string, event: EngineEvent): Promise<void> {
    return this.serial(async () => {
      const schedule = this.schedule(scheduleId);
      const prev = this.file.runs[scheduleId];
      if (!schedule || !prev) return;
      const { run, effects } = step(schedule, prev, event);
      await this.commit(scheduleId, run, effects);
    });
  }

  private schedule(id: string): Schedule | undefined {
    return this.file.schedules.find((s) => s.id === id);
  }

  private serial(fn: () => Promise<void>): Promise<void> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async persist(): Promise<void> {
    await this.ports.save(this.file);
    this.ports.publish(this.file);
  }

  private async commit(scheduleId: string, run: RunState, effects: Effect[]): Promise<void> {
    this.file = { ...this.file, runs: { ...this.file.runs, [scheduleId]: run } };
    await this.persist();
    for (const [taskId, t] of Object.entries(run.tasks)) {
      if (run.status !== "running" || !ACTIVE_STATUSES.has(t.status)) this.release(scheduleId, taskId);
    }
    for (const e of effects) void this.perform(scheduleId, e);
  }

  private release(scheduleId: string, taskId: string): void {
    const key = `${scheduleId}/${taskId}`;
    for (const stop of this.releases.get(key) ?? []) stop();
    this.releases.delete(key);
  }

  private async perform(scheduleId: string, e: Effect): Promise<void> {
    if (e.type === "name") {
      await this.ports.rename(e.sessionId, e.name).catch(() => undefined);
      return;
    }
    const schedule = this.schedule(scheduleId);
    const task = schedule?.tasks.find((t) => t.id === e.task);
    const run = this.file.runs[scheduleId];
    const launch = task && run?.launches[task.id];
    if (!schedule || !task || !run || !launch) {
      void this.dispatch(scheduleId, { type: "start-failed", task: e.task, error: "The task is no longer in the schedule." });
      return;
    }
    const workspace =
      task.workspace.kind === "sameAs" ? (run.tasks[task.workspace.task]?.workspace ?? task.project) : task.project;
    const sessionId = task.harness === "claude" ? this.ports.newSessionId() : undefined;
    const line = buildLaunchLine({
      plan: launch.plan,
      args: buildTaskArgs(task, e.prompt, sessionId),
      cwd: workspace,
      ownsAccount: task.harness === "claude",
      keepShell: false,
    });
    const send = (event: EngineEvent): void => void this.dispatch(scheduleId, event);
    let terminal: { terminalId: number; processId: number };
    try {
      terminal = await this.ports.launch(line, workspace);
    } catch (err) {
      send({ type: "start-failed", task: task.id, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    const onWatch = (w: WatchEvent): void => send({ ...w, task: task.id } as EngineEvent);
    const stopWatch =
      task.harness === "claude"
        ? this.ports.watchClaude({ sessionId: sessionId!, configDir: launch.configDir, permissionMode: task.permissionMode }, onWatch)
        : this.ports.watchOpencode({ workspace, permissionMode: task.permissionMode }, onWatch);
    const stopExit = this.ports.onExit(terminal.terminalId, () => send({ type: "exited", task: task.id }));
    this.releases.set(`${scheduleId}/${task.id}`, [stopWatch, stopExit]);
    // If the run was aborted while `launch` was pending, this event is ignored and
    // the commit that follows releases the watcher just registered.
    send({ type: "started", task: task.id, ...terminal, workspace, ...(sessionId ? { sessionId } : {}) });
  }
}
```

Note the ordering: `started` is dispatched after the watcher is registered, and dispatches are serialized, so a fast `session-found` still lands after `started` in the queue only if the watcher cannot fire synchronously — both watchers fire from timers or scan callbacks, never synchronously. The engine ignores `session-found` for a task that is not active, and `starting` is active, so an early one is still recorded.

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-runner.test.ts`
Expected: PASS.

- [ ] **Step 6: The RPC service**

```ts
// src/node/schedule/spexr-schedule-backend-service.ts
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { randomUUID } from "node:crypto";
import type { Schedule, TaskLaunch, ValidationProblem } from "../../common/schedule/schedule-types.js";
import type { ScheduleSnapshot, SpexrScheduleClient, SpexrScheduleService } from "../../common/schedule/schedule-protocol.js";
import { validateSchedule } from "../../common/schedule/schedule-validate.js";
import { SpexrDarkfactoryBackendService } from "../darkfactory/spexr-darkfactory-backend-service.js";
import { loadSchedules, saveSchedules, type ScheduleFile } from "./schedule-store.js";
import { ScheduleRunner } from "./schedule-runner.js";
import { SchedulePty } from "./schedule-pty.js";
import { defaultClaudeWatchDeps, everyMs, watchClaudeTask } from "./claude-task-watcher.js";
import { SCAN_EVERY_MS, watchOpencodeTask } from "./opencode-task-watcher.js";

@injectable()
export class SpexrScheduleBackendService implements SpexrScheduleService {
  @inject(SchedulePty) private readonly pty!: SchedulePty;
  @inject(SpexrDarkfactoryBackendService) private readonly wall!: SpexrDarkfactoryBackendService;
  private client?: SpexrScheduleClient;
  private runner!: Promise<ScheduleRunner>;

  @postConstruct()
  protected init(): void {
    this.runner = loadSchedules().then(async (file) => {
      const runner = new ScheduleRunner(this.ports(), file);
      await runner.recover();
      return runner;
    });
  }

  setClient(client: SpexrScheduleClient | undefined): void {
    this.client = client;
  }

  async snapshot(): Promise<ScheduleSnapshot> {
    const { schedules, runs } = (await this.runner).current;
    return { schedules, runs };
  }

  async save(schedule: Schedule): Promise<ValidationProblem[]> {
    const runner = await this.runner;
    if (runner.current.runs[schedule.id]?.status === "running") {
      return [{ field: "run", message: "Abort the run before editing its schedule." }];
    }
    const others = runner.current.schedules.filter((s) => s.id !== schedule.id);
    await runner.setSchedules([...others, schedule]);
    return validateSchedule(schedule);
  }

  async remove(scheduleId: string): Promise<void> {
    const runner = await this.runner;
    if (runner.current.runs[scheduleId]?.status === "running") throw new Error("Abort the run before deleting its schedule.");
    await runner.setSchedules(runner.current.schedules.filter((s) => s.id !== scheduleId));
  }

  async run(scheduleId: string, launches: Record<string, TaskLaunch>): Promise<ValidationProblem[]> {
    return (await this.runner).run(scheduleId, launches);
  }

  async abort(scheduleId: string): Promise<void> {
    await (await this.runner).abort(scheduleId);
  }

  private ports(): ConstructorParameters<typeof ScheduleRunner>[0] {
    return {
      launch: (line, cwd) => this.pty.launch(line, cwd),
      onExit: (id, l) => this.pty.onExit(id, l),
      watchClaude: (req, l) => watchClaudeTask(req, defaultClaudeWatchDeps, l),
      watchOpencode: (req, l) =>
        watchOpencodeTask(req, this.wall, { now: () => Date.now(), every: everyMs(SCAN_EVERY_MS) }, l),
      rename: (id, name) => this.wall.renameSession(id, name),
      newSessionId: () => randomUUID(),
      now: () => Date.now(),
      save: (file: ScheduleFile) => saveSchedules(file),
      publish: (file: ScheduleFile) => this.client?.onSnapshot({ schedules: file.schedules, runs: file.runs }),
    };
  }
}
```

(`everyMs(ms)` comes from `claude-task-watcher.ts`, Task 8.)

- [ ] **Step 7: Bind it**

In `src/node/spexr-backend-module.ts`, after the Dark Factory bindings:

```ts
  bind(SchedulePty).toSelf().inSingletonScope();
  bind(SpexrScheduleBackendService).toSelf().inSingletonScope();
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrScheduleBackendService);
      return new RpcConnectionHandler<SpexrScheduleClient>(SCHEDULE_SERVICE_PATH, (client) => {
        service.setClient(client);
        return service;
      });
    })
    .inSingletonScope();
```
with the imports for `SchedulePty`, `SpexrScheduleBackendService`, `SCHEDULE_SERVICE_PATH`, `SpexrScheduleClient`. If `src/node/spexr-backend-module.test.ts` enumerates bindings or service paths, add the new ones there.

- [ ] **Step 8: Verify**

Run: `npx vitest run --maxWorkers=2 src/node/ && pnpm run lint && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/common/schedule/schedule-protocol.ts src/node/schedule/ src/node/spexr-backend-module.ts src/node/spexr-backend-module.test.ts
git commit -m "feat(schedule): backend runner, ptys and RPC service; runs survive a reload (AC-5)"
```

### Task 12: Frontend client and wall cards for running tasks

**Files:**
- Create: `src/browser/darkfactory/schedule/schedule-client.ts`
- Create: `src/browser/darkfactory/schedule/schedule-wall.ts`
- Test: `src/browser/darkfactory/schedule/schedule-wall.test.ts`
- Modify: `src/browser/spexr-frontend-module.ts`
- Modify: `src/browser/darkfactory/darkfactory-wall-widget.tsx`

**Interfaces:**
- Consumes: `ScheduleSnapshot`, `SpexrScheduleService`, `SpexrScheduleClient` (Task 11); `SpexrDarkfactoryTerminalManager.reattach(key, {terminalId, processId}, projectPath)` (existing).
- Produces: `SpexrScheduleClientDispatcher` (`onSnapshot$: Event<ScheduleSnapshot>`), `SpexrScheduleServiceProxy` symbol; `taskCardsToMount(snapshot, mounted: ReadonlySet<string>): TaskCard[]` — `mounted` holds both card keys and session ids the wall already shows with `TaskCard = { key: string; terminalId: number; processId: number; workspace: string; harness: HarnessId; sessionId?: string }`.

- [ ] **Step 1: Failing tests**

```ts
// src/browser/darkfactory/schedule/schedule-wall.test.ts
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
```

- [ ] **Step 2: Run to verify it fails, then implement**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/schedule/schedule-wall.test.ts` — FAIL (module missing).

```ts
// src/browser/darkfactory/schedule/schedule-wall.ts
import type { HarnessId } from "../../../common/harness/harness-types.js";
import type { ScheduleSnapshot } from "../../../common/schedule/schedule-protocol.js";
import { ACTIVE_STATUSES } from "../../../common/schedule/schedule-types.js";

export interface TaskCard {
  key: string;
  terminalId: number;
  processId: number;
  workspace: string;
  harness: HarnessId;
  sessionId?: string;
}

/**
 * Terminals of running tasks this window has no card for yet, keyed by
 * terminal id. `mounted` holds card keys and session ids: after a reload the
 * wall restores an adopted task as a pinned session, and a second card on the
 * same pty must not appear.
 */
export function taskCardsToMount(snapshot: ScheduleSnapshot, mounted: ReadonlySet<string>): TaskCard[] {
  const cards: TaskCard[] = [];
  for (const schedule of snapshot.schedules) {
    const run = snapshot.runs[schedule.id];
    if (!run || run.status !== "running") continue;
    for (const task of schedule.tasks) {
      const t = run.tasks[task.id];
      if (!t || !ACTIVE_STATUSES.has(t.status) || t.terminalId === undefined || t.processId === undefined || !t.workspace) continue;
      const key = `spexr-task-${t.terminalId}`;
      if (mounted.has(key) || (t.sessionId !== undefined && mounted.has(t.sessionId))) continue;
      cards.push({ key, terminalId: t.terminalId, processId: t.processId, workspace: t.workspace, harness: task.harness, ...(t.sessionId ? { sessionId: t.sessionId } : {}) });
    }
  }
  return cards;
}
```

Run again — PASS.

- [ ] **Step 3: Client dispatcher and bindings**

```ts
// src/browser/darkfactory/schedule/schedule-client.ts
import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { ScheduleSnapshot, SpexrScheduleClient } from "../../../common/schedule/schedule-protocol.js";

export const SpexrScheduleServiceProxy = Symbol("SpexrScheduleServiceProxy");

/** Receives the backend's schedule snapshots; the sidebar and the wall subscribe. */
@injectable()
export class SpexrScheduleClientDispatcher implements SpexrScheduleClient {
  private readonly snapshots = new Emitter<ScheduleSnapshot>();
  readonly onSnapshot$: Event<ScheduleSnapshot> = this.snapshots.event;

  onSnapshot(snapshot: ScheduleSnapshot): void {
    this.snapshots.fire(snapshot);
  }
}
```

In `src/browser/spexr-frontend-module.ts`, next to the Dark Factory proxy binding:

```ts
  bind(SpexrScheduleClientDispatcher).toSelf().inSingletonScope();
  bind(SpexrScheduleServiceProxy)
    .toDynamicValue((ctx) => {
      const connection = ctx.container.get(WebSocketConnectionProvider);
      return connection.createProxy(SCHEDULE_SERVICE_PATH, ctx.container.get(SpexrScheduleClientDispatcher));
    })
    .inSingletonScope();
```

- [ ] **Step 4: Mount task cards in the wall**

In `darkfactory-wall-widget.tsx`:
- inject `@inject(SpexrScheduleServiceProxy) private readonly schedules!: SpexrScheduleService;` and `@inject(SpexrScheduleClientDispatcher) private readonly scheduleClient!: SpexrScheduleClientDispatcher;`;
- add `private scheduleSnapshot: ScheduleSnapshot = { schedules: [], runs: {} };` and `private readonly mountedTasks = new Set<string>();`;
- in the widget's init (where it subscribes to `onTilesChanged$`), add:

```ts
    this.toDispose.push(this.scheduleClient.onSnapshot$((s) => this.onScheduleSnapshot(s)));
    void this.schedules.snapshot().then((s) => this.onScheduleSnapshot(s)).catch(() => undefined);
```
- add the method:

```ts
  /**
   * A running task is a launched card: attach to its backend terminal and let
   * the scan adopt it like any session started here. Each terminal is mounted
   * once per window.
   */
  private onScheduleSnapshot(snapshot: ScheduleSnapshot): void {
    this.scheduleSnapshot = snapshot;
    const mounted = new Set<string>([
      ...this.mountedTasks,
      ...this.pinned,
      ...this.launched.map((l) => l.key),
    ]);
    for (const card of taskCardsToMount(snapshot, mounted)) {
      this.mountedTasks.add(card.key);
      void this.terminals
        .reattach(card.key, { terminalId: card.terminalId, processId: card.processId }, card.workspace)
        .then((term) => {
          if (!term) return;
          const known = new Set(this.tiles.map((t) => t.sessionId).filter((id) => id !== card.sessionId));
          this.launched = [
            ...this.launched,
            {
              key: card.key,
              projectPath: card.workspace,
              projectName: card.workspace.split("/").filter(Boolean).pop() ?? card.workspace,
              harness: card.harness,
              knownBefore: known,
            },
          ];
          this.update();
        })
        .catch(() => undefined);
    }
    this.update();
  }
```

- [ ] **Step 5: Verify**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/ && pnpm run lint && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/browser/darkfactory/schedule/ src/browser/spexr-frontend-module.ts src/browser/darkfactory/darkfactory-wall-widget.tsx
git commit -m "feat(schedule): running tasks appear as wall cards on their backend terminals"
```

### Task 13: Minimal sidebar

**Files:**
- Create: `src/browser/darkfactory/schedule/schedule-view.ts`
- Test: `src/browser/darkfactory/schedule/schedule-view.test.ts`
- Create: `src/browser/darkfactory/schedule/sidebar-prefs.ts`
- Test: `src/browser/darkfactory/schedule/sidebar-prefs.test.ts`
- Create: `src/browser/darkfactory/schedule/schedule-sidebar.tsx`
- Modify: `src/browser/darkfactory/darkfactory-wall-widget.tsx` (shell row + sidebar)
- Modify: `src/browser/style/spexr.css`

**Interfaces:**
- Consumes: snapshot (Task 11), `layersOf` (Task 1), `validateSchedule` (Task 3), `UNATTENDED_MODES` (Task 1), `resolveLaunch` (Task 6).
- Produces: `STATUS_VIEW: Record<TaskStatus, { label: string; icon: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }>`; `taskRows(schedule, run?): TaskRow[]` where `TaskRow = { id; name; harness; layer: number; waitsFor: string[]; status: TaskStatus; label; icon; tone; iteration?: string; unattended: boolean; error?: string }`; `runBar(schedule, run?, problems): { canRun: boolean; canAbort: boolean; label: string; reasons: string[] }`; `newTask(project: string, taken: ReadonlySet<string>): ScheduleTask`; `newSchedule(taken: ReadonlySet<string>): Schedule`; `readSidebarPrefs(storage)`, `writeSidebarPrefs(storage, prefs)` with `SidebarPrefs = { open: boolean; width: number }`, width clamped 280..560, default `{ open: true, width: 340 }`.

- [ ] **Step 1: Failing view-model tests**

```ts
// src/browser/darkfactory/schedule/schedule-view.test.ts
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
```

```ts
// src/browser/darkfactory/schedule/sidebar-prefs.test.ts
import { describe, expect, it } from "vitest";
import { readSidebarPrefs, writeSidebarPrefs } from "./sidebar-prefs.js";

function storage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("sidebar prefs", () => {
  it("defaults to open at 340px", () => {
    expect(readSidebarPrefs(storage())).toEqual({ open: true, width: 340 });
  });
  it("round-trips and clamps the width", () => {
    const st = storage();
    writeSidebarPrefs(st, { open: false, width: 9_000 });
    expect(readSidebarPrefs(st)).toEqual({ open: false, width: 560 });
  });
  it("survives junk and a throwing storage", () => {
    expect(readSidebarPrefs(storage({ "spexr.darkfactory.scheduleSidebar": "{" }))).toEqual({ open: true, width: 340 });
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readSidebarPrefs(throwing)).toEqual({ open: true, width: 340 });
    expect(() => writeSidebarPrefs(throwing, { open: true, width: 300 })).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/schedule/`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement the view model and prefs**

```ts
// src/browser/darkfactory/schedule/schedule-view.ts
import type { HarnessId } from "../../../common/harness/harness-types.js";
import {
  UNATTENDED_MODES,
  type RunState,
  type Schedule,
  type ScheduleTask,
  type TaskStatus,
  type ValidationProblem,
} from "../../../common/schedule/schedule-types.js";
import { layersOf } from "../../../common/schedule/schedule-graph.js";

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** Label and icon for every status: state is never shown by colour alone. */
export const STATUS_VIEW: Readonly<Record<TaskStatus, { label: string; icon: string; tone: Tone }>> = {
  pending: { label: "Waiting", icon: "codicon-circle-large-outline", tone: "neutral" },
  starting: { label: "Starting", icon: "codicon-loading", tone: "info" },
  running: { label: "Working", icon: "codicon-play-circle", tone: "info" },
  "waiting-on-you": { label: "Needs you", icon: "codicon-bell-dot", tone: "warning" },
  checking: { label: "Checking", icon: "codicon-beaker", tone: "info" },
  held: { label: "Held", icon: "codicon-debug-pause", tone: "neutral" },
  converged: { label: "Converged", icon: "codicon-pass-filled", tone: "success" },
  failed: { label: "Failed", icon: "codicon-error", tone: "danger" },
  skipped: { label: "Skipped", icon: "codicon-debug-step-over", tone: "neutral" },
  interrupted: { label: "Interrupted", icon: "codicon-debug-disconnect", tone: "warning" },
};

export interface TaskRow {
  id: string;
  name: string;
  harness: HarnessId;
  layer: number;
  waitsFor: string[];
  status: TaskStatus;
  label: string;
  icon: string;
  tone: Tone;
  iteration?: string;
  unattended: boolean;
  error?: string;
}

/** Rows in layer order (depth first, then schedule order), with their run state when there is a run. */
export function taskRows(schedule: Schedule, run?: RunState): TaskRow[] {
  const byId = new Map(schedule.tasks.map((t) => [t.id, t]));
  return layersOf(schedule).flatMap((ids, layer) =>
    ids.map((id) => {
      const t = byId.get(id)!;
      const state = run?.tasks[id];
      const status = state?.status ?? "pending";
      const max = t.loop?.maxIterations;
      return {
        id,
        name: t.name,
        harness: t.harness,
        layer,
        waitsFor: t.needs.map((n) => byId.get(n)?.name ?? n),
        status,
        ...STATUS_VIEW[status],
        ...(state && max && state.iteration > 0 ? { iteration: `${state.iteration} / ${max}` } : {}),
        unattended: !!t.permissionMode && UNATTENDED_MODES[t.harness].includes(t.permissionMode),
        ...(state?.error ? { error: state.error } : {}),
      };
    }),
  );
}

/** What the run bar offers, and why Run is unavailable when it is. */
export function runBar(
  schedule: Schedule,
  run: RunState | undefined,
  problems: ValidationProblem[],
): { canRun: boolean; canAbort: boolean; label: string; reasons: string[] } {
  const names = new Map(schedule.tasks.map((t) => [t.id, t.name]));
  const reasons = problems.map((p) => (p.task ? `${names.get(p.task) ?? p.task}: ${p.message}` : p.message));
  const running = run?.status === "running";
  const label = !run ? "Not run yet" : running ? (run.pausedBy ? "Paused" : "Running") : run.status === "finished" ? "Finished" : "Aborted";
  return { canRun: !running && reasons.length === 0, canAbort: running, label, reasons };
}

/** A blank task in `project`, id unique in the schedule. */
export function newTask(project: string, taken: ReadonlySet<string>): ScheduleTask {
  let n = 1;
  while (taken.has(`task-${n}`)) n++;
  return { id: `task-${n}`, name: `Task ${n}`, needs: [], project, workspace: { kind: "folder" }, harness: "claude", prompt: "" };
}

export function newSchedule(taken: ReadonlySet<string>): Schedule {
  let n = 1;
  while (taken.has(`schedule-${n}`)) n++;
  return { id: `schedule-${n}`, name: `Schedule ${n}`, tasks: [] };
}
```

```ts
// src/browser/darkfactory/schedule/sidebar-prefs.ts
const KEY = "spexr.darkfactory.scheduleSidebar";
export const SIDEBAR_MIN = 280;
export const SIDEBAR_MAX = 560;
const DEFAULT: SidebarPrefs = { open: true, width: 340 };

export interface SidebarPrefs {
  open: boolean;
  width: number;
}
interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const clamp = (w: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));

/** The sidebar's open state and width for this window; defaults on anything unreadable. */
export function readSidebarPrefs(storage: PrefStorage): SidebarPrefs {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "null") as Partial<SidebarPrefs> | null;
    if (!raw || typeof raw !== "object") return DEFAULT;
    return {
      open: typeof raw.open === "boolean" ? raw.open : DEFAULT.open,
      width: typeof raw.width === "number" && Number.isFinite(raw.width) ? clamp(raw.width) : DEFAULT.width,
    };
  } catch {
    return DEFAULT;
  }
}

export function writeSidebarPrefs(storage: PrefStorage, prefs: SidebarPrefs): void {
  try {
    storage.setItem(KEY, JSON.stringify({ open: prefs.open, width: clamp(prefs.width) }));
  } catch {
    /* storage blocked: the preference is a convenience */
  }
}
```

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/schedule/` — PASS.

- [ ] **Step 4: The sidebar component**

The component renders only; every decision comes from `schedule-view.ts`. Edits live in a local draft saved 600 ms after typing stops (and on blur, Run, or switching schedule); `validateSchedule` runs on the draft, so problems show as the operator types. Tasks are editable whenever the schedule is not running — also after a finished or aborted run. Slice 2 edits one task at a time with the fields name, project, harness, account, model, permission mode, prompt (no needs, workspace, loop — Slices 3–4).

```tsx
// src/browser/darkfactory/schedule/schedule-sidebar.tsx
import * as React from "@theia/core/shared/react";
import type { HarnessId } from "../../../common/harness/harness-types.js";
import type { ScheduleSnapshot } from "../../../common/schedule/schedule-protocol.js";
import { PERMISSION_MODES, type Schedule, type ScheduleTask, type ValidationProblem } from "../../../common/schedule/schedule-types.js";
import { validateSchedule } from "../../../common/schedule/schedule-validate.js";
import { newSchedule, newTask, runBar, taskRows } from "./schedule-view.js";

export interface ScheduleSidebarProps {
  snapshot: ScheduleSnapshot;
  projects: readonly { path: string; name: string }[];
  width: number;
  onSave(schedule: Schedule): void;
  onRemove(scheduleId: string): void;
  onRun(schedule: Schedule): void;
  onAbort(scheduleId: string): void;
  onFocusTask(scheduleId: string, taskId: string): void;
  onClose(): void;
}

/** The plant schedule pane: pick a schedule, see its tasks by layer, run it. */
export function ScheduleSidebar(p: ScheduleSidebarProps): React.ReactElement {
  const [selectedId, setSelectedId] = React.useState<string | undefined>(p.snapshot.schedules[0]?.id);
  const [editing, setEditing] = React.useState<string | undefined>();
  const [confirmAbort, setConfirmAbort] = React.useState(false);
  // Edits go to a local draft and are saved after a pause in typing: saving
  // every keystroke over RPC made controlled inputs lag and drop characters.
  const [draft, setDraft] = React.useState<Schedule | undefined>();
  const saveTimer = React.useRef<ReturnType<typeof setTimeout>>();
  const saved = p.snapshot.schedules.find((s) => s.id === selectedId) ?? p.snapshot.schedules[0];
  const schedule = draft && draft.id === saved?.id ? draft : saved;
  const run = schedule ? p.snapshot.runs[schedule.id] : undefined;
  const running = run?.status === "running";
  const edit = (next: Schedule): void => {
    setDraft(next);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => p.onSave(next), 600);
  };
  const flush = (): void => {
    if (!draft) return;
    clearTimeout(saveTimer.current);
    p.onSave(draft);
  };
  React.useEffect(() => () => clearTimeout(saveTimer.current), []);
  const problems: ValidationProblem[] = schedule ? validateSchedule(schedule) : [];
  const bar = schedule ? runBar(schedule, run, problems) : undefined;
  const [announce, setAnnounce] = React.useState("");
  React.useEffect(() => setAnnounce(bar ? `Schedule ${bar.label.toLowerCase()}` : ""), [bar?.label]);

  const addSchedule = (): void => {
    const s = newSchedule(new Set(p.snapshot.schedules.map((x) => x.id)));
    p.onSave(s);
    setSelectedId(s.id);
  };
  const updateTask = (task: ScheduleTask): void => {
    if (!schedule) return;
    edit({ ...schedule, tasks: schedule.tasks.map((t) => (t.id === task.id ? task : t)) });
  };
  const addTask = (): void => {
    if (!schedule) return;
    const t = newTask(p.projects[0]?.path ?? "", new Set(schedule.tasks.map((x) => x.id)));
    edit({ ...schedule, tasks: [...schedule.tasks, t] });
    setEditing(t.id);
  };

  return (
    <aside className="spexr-sched" style={{ width: p.width }} aria-label="Plant schedule">
      <header className="spexr-sched__head">
        <span className="sl-eyebrow">Plant schedule</span>
        <button className="sl-icon-btn" onClick={p.onClose} aria-label="Close the schedule" title="Close">
          <i className="codicon codicon-layout-sidebar-right-off" />
        </button>
      </header>
      {!schedule ? (
        <div className="sl-empty spexr-sched__empty">
          <p>Lay out agent sessions, say which waits for which, and run them.</p>
          <button className="sl-btn sl-btn--primary" onClick={addSchedule}>New schedule</button>
        </div>
      ) : (
        <>
          <div className="spexr-sched__picker">
            <label className="sl-field">
              <span className="sl-field__label">Schedule</span>
              <span className="sl-field__control">
                <span className="sl-select">
                  <select className="sl-field__input" value={schedule.id} onChange={(e) => { flush(); setDraft(undefined); setSelectedId(e.target.value); }}>
                    {p.snapshot.schedules.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </span>
              </span>
            </label>
            <button className="sl-icon-btn" onClick={addSchedule} aria-label="New schedule" title="New schedule">
              <i className="codicon codicon-add" />
            </button>
            <button
              className="sl-icon-btn"
              onClick={() => p.onRemove(schedule.id)}
              disabled={running}
              aria-label="Delete this schedule"
              title="Delete this schedule"
            >
              <i className="codicon codicon-trash" />
            </button>
          </div>
          <label className="sl-field">
            <span className="sl-field__label">Name</span>
            <span className="sl-field__control">
              <input className="sl-field__input" value={schedule.name} disabled={running} onChange={(e) => edit({ ...schedule, name: e.target.value })} onBlur={flush} />
            </span>
          </label>

          <div className="spexr-sched__runbar" aria-live="polite">
            <span className="sl-tag">{bar!.label}</span>
            {bar!.canAbort ? (
              confirmAbort ? (
                <span className="spexr-sched__confirm">
                  Stop starting tasks? Sessions stay open.
                  <button className="sl-btn sl-btn--sm" onClick={() => { p.onAbort(schedule.id); setConfirmAbort(false); }}>Abort</button>
                  <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => setConfirmAbort(false)}>Keep running</button>
                </span>
              ) : (
                <button className="sl-btn sl-btn--sm" onClick={() => setConfirmAbort(true)}>Abort</button>
              )
            ) : (
              <button className="sl-btn sl-btn--primary sl-btn--sm" disabled={!bar!.canRun} onClick={() => { flush(); p.onRun(schedule); }}>
                Run
              </button>
            )}
          </div>
          {bar!.reasons.length > 0 && (
            <div className="sl-callout sl-callout--warning spexr-sched__reasons">
              <ul>{bar!.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}

          <ol className="spexr-sched__tasks">
            {taskRows(schedule, run).map((row) => (
              <li key={row.id} className="spexr-sched__row" data-layer={row.layer} data-tone={row.tone} aria-current={editing === row.id ? "true" : undefined}>
                <button className="spexr-sched__rowmain" onClick={() => (running ? p.onFocusTask(schedule.id, row.id) : setEditing(row.id))}>
                  <span className="spexr-sched__name">{row.name}</span>
                  <span className={`sl-badge spexr-sched__state spexr-sched__state--${row.tone}`}>
                    <i className={`codicon ${row.icon}`} aria-hidden="true" /> {row.label}
                    {row.iteration ? ` · ${row.iteration}` : ""}
                  </span>
                  {row.unattended && (
                    <span className="sl-tag spexr-sched__warn" title="Tools run without asking">
                      <i className="codicon codicon-warning" aria-hidden="true" /> Unattended
                    </span>
                  )}
                  {row.waitsFor.length > 0 && <span className="spexr-sched__waits">after {row.waitsFor.join(", ")}</span>}
                  {row.error && <span className="spexr-sched__error">{row.error}</span>}
                </button>
                {!running && (
                  <button className="sl-icon-btn" onClick={() => setEditing(editing === row.id ? undefined : row.id)} aria-label={`Edit ${row.name}`}>
                    <i className="codicon codicon-edit" />
                  </button>
                )}
                {editing === row.id && !running && (
                  <div onBlur={flush}>
                  <TaskEditor
                    task={schedule.tasks.find((t) => t.id === row.id)!}
                    projects={p.projects}
                    problems={problems.filter((x) => x.task === row.id)}
                    onChange={updateTask}
                  />
                  </div>
                )}
              </li>
            ))}
          </ol>
          {!running && (
            <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={addTask}>
              <i className="codicon codicon-add" aria-hidden="true" /> Add a task
            </button>
          )}
        </>
      )}
      <span className="spexr-sched__sr" aria-live="polite">{announce}</span>
    </aside>
  );
}

function TaskEditor(p: {
  task: ScheduleTask;
  projects: readonly { path: string; name: string }[];
  problems: ValidationProblem[];
  onChange(task: ScheduleTask): void;
}): React.ReactElement {
  const t = p.task;
  const problem = (field: string): string | undefined => p.problems.find((x) => x.field === field)?.message;
  const set = (patch: Partial<ScheduleTask>): void => p.onChange({ ...t, ...patch });
  const field = (label: string, name: string, control: React.ReactNode): React.ReactElement => (
    <label className="sl-field" data-invalid={problem(name) ? "true" : undefined}>
      <span className="sl-field__label">{label}</span>
      <span className="sl-field__control">{control}</span>
      {problem(name) && <span className="sl-field__hint spexr-sched__problem">{problem(name)}</span>}
    </label>
  );
  return (
    <div className="spexr-sched__editor">
      {field("Name", "name", <input className="sl-field__input" value={t.name} onChange={(e) => set({ name: e.target.value })} />)}
      {field("Project", "project", (
        <span className="sl-select">
          <select className="sl-field__input" value={t.project} onChange={(e) => set({ project: e.target.value })}>
            {p.projects.map((x) => <option key={x.path} value={x.path}>{x.name}</option>)}
          </select>
        </span>
      ))}
      {field("Harness", "harness", (
        <span className="sl-select">
          <select className="sl-field__input" value={t.harness} onChange={(e) => set({ harness: e.target.value as HarnessId, permissionMode: undefined })}>
            <option value="claude">claude</option>
            <option value="opencode">opencode</option>
          </select>
        </span>
      ))}
      {field("Prompt", "prompt", <textarea className="sl-field__input spexr-sched__prompt" rows={5} value={t.prompt} onChange={(e) => set({ prompt: e.target.value })} />)}
      <details className="spexr-sched__advanced">
        <summary>Model and permissions</summary>
        {field("Model", "model", <input className="sl-field__input" value={t.model ?? ""} placeholder="default" onChange={(e) => set({ model: e.target.value || undefined })} />)}
        {field("Permission mode", "permissionMode", (
          <span className="sl-select">
            <select className="sl-field__input" value={t.permissionMode ?? ""} onChange={(e) => set({ permissionMode: e.target.value || undefined })}>
              <option value="">ask (default)</option>
              {PERMISSION_MODES[t.harness].map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </span>
        ))}
      </details>
    </div>
  );
}
```

Account selection uses the task's `configDir` left empty in Slice 2 (the terminal manager then resolves the active profile, as for a wall session); the account picker joins the editor in Slice 4 together with the other fields.

- [ ] **Step 5: Wire the sidebar into the wall**

In `darkfactory-wall-widget.tsx`:
- add `private sidebar = readSidebarPrefs(window.localStorage);`;
- wrap the returned tree: replace `<div className="spexr-df-root">…</div>` with

```tsx
        <div className="spexr-df-shell">
          <div className="spexr-df-root">{/* unchanged content */}</div>
          {this.sidebar.open ? (
            <ScheduleSidebar
              snapshot={this.scheduleSnapshot}
              projects={launchTargets(this.tiles, currentProject, this.recentProjects).map((t) => ({ path: t.path, name: t.name }))}
              width={this.sidebar.width}
              onSave={(s) => void this.schedules.save(s).then(() => this.refreshSchedules())}
              onRemove={(id) => void this.schedules.remove(id).then(() => this.refreshSchedules())}
              onRun={(s) => void this.runSchedule(s)}
              onAbort={(id) => void this.schedules.abort(id)}
              onFocusTask={(sid, tid) => this.focusTask(sid, tid)}
              onClose={() => this.setSidebarOpen(false)}
            />
          ) : (
            <button className="sl-icon-btn spexr-df-shell__open" onClick={() => this.setSidebarOpen(true)} aria-label="Open the plant schedule" title="Plant schedule">
              <i className="codicon codicon-layout-sidebar-right" />
            </button>
          )}
        </div>
```
- add the methods:

```ts
  private refreshSchedules(): void {
    void this.schedules.snapshot().then((s) => this.onScheduleSnapshot(s)).catch(() => undefined);
  }

  /** Resolve every task's launch here, where the preferences are, then hand the run to the backend. */
  private async runSchedule(schedule: Schedule): Promise<void> {
    const launches = Object.fromEntries(
      schedule.tasks.map((t) => [t.id, this.terminals.resolveLaunch(t.harness, t.configDir ?? "", t.project)]),
    );
    await this.schedules.run(schedule.id, launches);
    this.refreshSchedules();
  }

  /** Scroll to and focus a running task's card. */
  private focusTask(scheduleId: string, taskId: string): void {
    const terminalId = this.scheduleSnapshot.runs[scheduleId]?.tasks[taskId]?.terminalId;
    if (terminalId === undefined) return;
    const term = this.terminals.live(`spexr-task-${terminalId}`);
    term?.node.scrollIntoView({ block: "nearest", behavior: "smooth" });
    term?.activate();
  }

  private setSidebarOpen(open: boolean): void {
    this.sidebar = { ...this.sidebar, open };
    writeSidebarPrefs(window.localStorage, this.sidebar);
    this.update();
  }
```
(A task's card is keyed `spexr-task-<terminalId>` until the scan adopts it, then by its session id; when `live(key)` misses, fall back to `this.terminals.live(sessionId)` using the task's `sessionId`.)

- [ ] **Step 6: Styles**

Append to `src/browser/style/spexr.css`, near the other `.spexr-df-*` layout rules (after `.spexr-df-root`, line ~2440). Tokens only:

```css
/* The wall and the plant schedule side by side; the wall keeps the room it needs. */
.spexr-df-shell { display: flex; align-items: flex-start; gap: var(--sl-space-5); }
.spexr-df-shell > .spexr-df-root { flex: 1 1 auto; min-width: 0; }
.spexr-df-shell__open { position: sticky; top: var(--sl-space-3); }

.spexr-sched {
  position: sticky; top: 0; flex: none;
  display: flex; flex-direction: column; gap: var(--sl-space-4);
  max-height: 100vh; overflow-y: auto;
  padding: var(--sl-space-4);
  border-left: 1px solid var(--sl-border-subtle);
  background: var(--sl-surface-raised, var(--sl-surface-default));
}
.spexr-sched__head, .spexr-sched__picker, .spexr-sched__runbar { display: flex; align-items: center; gap: var(--sl-space-2); }
.spexr-sched__head { justify-content: space-between; }
.spexr-sched__picker > .sl-field { flex: 1; }
.spexr-sched__runbar { justify-content: space-between; }
.spexr-sched__confirm { display: flex; align-items: center; gap: var(--sl-space-2); font-size: var(--sl-text-sm); }
.spexr-sched__tasks { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sl-space-2); }
/* Layers read as bands: each depth steps in, so "after" is visible at a glance. */
.spexr-sched__row { display: grid; grid-template-columns: 1fr auto; gap: var(--sl-space-2); padding-left: calc(var(--sl-space-4) * var(--layer, 0)); }
.spexr-sched__row[data-layer="1"] { --layer: 1; }
.spexr-sched__row[data-layer="2"] { --layer: 2; }
.spexr-sched__row[data-layer="3"] { --layer: 3; }
.spexr-sched__rowmain {
  all: unset; box-sizing: border-box; cursor: pointer;
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--sl-space-2);
  padding: var(--sl-space-2) var(--sl-space-3);
  border: 1px solid var(--sl-border-subtle); border-radius: var(--sl-radius-md);
  transition: border-color var(--sl-motion-fast, 120ms) var(--sl-motion-ease);
}
.spexr-sched__rowmain:hover { border-color: var(--sl-border-default); }
.spexr-sched__rowmain:focus-visible { outline: 2px solid var(--sl-focus-ring); outline-offset: 2px; }
.spexr-sched__row[aria-current="true"] .spexr-sched__rowmain { border-color: var(--sl-accent-default); }
.spexr-sched__name { font-weight: 600; }
.spexr-sched__waits, .spexr-sched__error { flex-basis: 100%; font-size: var(--sl-text-xs); color: var(--sl-text-muted); }
.spexr-sched__error { color: var(--sl-status-danger); }
.spexr-sched__editor { grid-column: 1 / -1; display: flex; flex-direction: column; gap: var(--sl-space-3); padding: var(--sl-space-3); }
.spexr-sched__prompt { min-height: 6rem; resize: vertical; font-family: var(--sl-font-mono); }
.spexr-sched__problem { color: var(--sl-status-danger); }
.spexr-sched__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (prefers-reduced-motion: reduce) { .spexr-sched__rowmain { transition: none; } }
```

Check each `--sl-*` name used exists in the kit or `spexr.css` (`grep -o -- '--sl-[a-z0-9-]*' node_modules/@sondalab/ui-kit/*.css | sort -u`) and swap any that does not for the nearest existing one; add to the power-save rule in `spexr.css` (line ~155) nothing — the sidebar has no effects classes.

- [ ] **Step 7: Verify**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/ src/common/schedule/ src/node/schedule/ && pnpm run lint && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 8: Manual check in the app (AC-5, AC-7, AC-8)** — rebuild, quit any running SPEXR first (`docs/memory/electron-single-instance-lock.md`), then:
1. New schedule → one Claude task in a scratch repo, prompt "Reply with the word pong." → Run. A card appears on the wall and the row shows Working, then Converged.
2. Same with a permission-asking prompt ("Create a file hello.txt") without a permission mode → the row shows Needs you until approved in the card.
3. Reload the window mid-run → the card comes back, the run continues.
4. Both themes; keyboard only: Tab reaches every control with a visible focus ring; the run state change is announced.
5. One opencode task → converges (tens of seconds late is expected).

- [ ] **Step 9: Commit**

```bash
git add src/browser/darkfactory/schedule/ src/browser/darkfactory/darkfactory-wall-widget.tsx src/browser/style/spexr.css
git commit -m "feat(schedule): minimal plant-schedule sidebar in the Dark Factory (AC-8)"
```

**Slice 2 ends here.** Push to https://github.com/sondalab-ai/spexr-ide/pull/66 and tick the slice.

---

# Slice 3 — Loop until converged

Planned in full on 2026-09-27, against the code as it stands after Task 13 (commit `538e17a`), not against the Slice 2 task text: where the two differ, the code wins. The rulings below were taken while planning; each names what it costs if it proves wrong.

**Rulings for this slice**

- **R1. `arm()` does not arm at once.** Right after a turn end, the transcript or tile still shows that reply. If `arm()` set the tracker's flag directly, the next read would count the old reply again (Review Focus 1). Instead, `arm()` records how many prompts the watcher has seen: genuine prompts parsed so far for Claude, the tile's `turnCount` for opencode. The tracker is armed only once that number goes up. The runner calls `arm()` **before** it writes the paste, so no read can parse the pasted prompt before the baseline exists. *Cost if wrong:* if a harness writes the pasted prompt in a form `isPrompt` does not recognise, a fast reply to it (one that lands between two reads) is missed and the task waits until the operator intervenes. A slow reply is still caught through the "seen working" path.
- **R2. The pasted text is cleaned before it is wrapped.** A follow-up can carry a check's output, and that output comes from code the agent wrote. A tail containing `ESC[201~` would end the paste early and deliver the rest as keystrokes (a slash command, an Enter). So `bracketedPaste` turns CR into LF and drops ESC and every other C0/C1 control character except `\n` and `\t`. *Cost if wrong:* none known. Colour codes in check output arrive as plain text, and `LineTail` strips them before that point anyway.
- **R3. The single `pausedBy` field carries both pauses.** An operator pause always wins: `pause` sets `"operator"`, and `fail()` never overwrites `"operator"`. `resume` does not store the failure pause separately; it works it out again, setting `"failure"` while any task is `failed` or `interrupted` and clearing it otherwise. It then replays every held task in schedule order. Slice 4's retry and skip use the same rule. *Cost if wrong:* none. Nothing is lost that cannot be read from the task statuses.
- **R4. While the operator has paused the run, every turn end is held, not only looping ones.** No check starts, no follow-up is pasted, and even a non-looping task shows *Held* instead of *Converged* until Resume. A check that is already running finishes. If it passes, the task converges. If it fails, the task is held along with the check's output. A newer turn end on a held task (the operator typed into the card) replaces the held reply. The invariant is: "a paused run changes nothing on its own except failures." *Cost if wrong:* a task that finished during a pause reads *Held* until Resume.
- **R5. After the shell exits, the check's process group is killed.** A check that ran for longer than its timeout gets SIGTERM, then SIGKILL after 5 s. Whatever a check leaves running in its group once its shell exits gets SIGKILL straight away. The result is taken on `exit` plus a 500 ms drain, not on `close`, because a grandchild that left the group can hold the pipe open forever and wedge the backend-wide queue. *Cost if wrong:* a check that deliberately leaves a background process running in its own group loses it when the shell exits.
- **R6. Placeholders are rejected in `loop.check` and `loop.followUp`.** Validation refuses them, and the engine passes the check command through exactly as written. So an operator never believes `{{a.reply}}` is filled in where it is not, and model output never reaches a shell. *Cost if wrong:* a follow-up cannot quote an upstream reply; the operator puts it in the first prompt instead.
- **R7. `checkTimeoutSec` must be an integer from 1 to 3600.** *Cost if wrong:* a check suite longer than an hour cannot be the gate. The constant can be raised in one line.
- **R8. opencode takes follow-ups by paste too.** Evidence: a probe on 2026-09-27 against opencode 1.18.18 in a scripted pty. A 2-line bracketed paste lands in the input box, and a 60-line paste collapses into a `[Pasted ~60 lines]` chip. Neither submits mid-paste. That Enter then sends the paste as one message is still unverified; Task 14 Step 2 checks it. If it fails, looping opencode tasks are rejected in validation (Task 14 Step 3). The spec's fallback (`--resume <id> "<follow-up>"`) is **not** taken. It ends the pty, which the engine counts as `exited` → `failed`, and the new process gets a new terminal id, so the card is lost. *Cost if wrong:* until a later change, opencode tasks could not loop.
- **R9. Aborting a run skips its queued checks.** They are not spawned once their turn comes, because the runner's `stillWanted` returns false. A check already running when the run is aborted finishes or times out; nothing kills it early. *Cost if wrong:* an aborted run's current check can use the machine for up to its timeout.
- **R10. The check runs as `$SHELL -l -c`, not `-i -l -c` like the launch line.** An interactive shell with no terminal took 1.7 s against 24 ms in a measurement on 2026-09-27 (zsh, this machine), and it wrote `Saving session...completed.` to stderr, which would pollute every tail. The check keeps the backend's environment, which is the same one the task's pty inherits, plus the login files (`.zprofile`, `.zlogin`), but not `.zshrc`. The sidebar says so next to the field. *Cost if wrong:* a check command that is found only through `.zshrc` fails with "command not found". That message shows in the follow-up and in the failed row, and the operator fixes it with a full path or `source ~/.zshrc && …`.

### Task 14: Probe — opencode takes a bracketed paste — DONE 2026-09-27 (paste + Enter → one message; Step 3 not needed)

**Files:**
- Modify: `docs/specs/0018-plant-schedule.md` (Risks → "Pasting into opencode", and the Probe results list)
- Conditionally modify (Step 3 only): `src/common/schedule/schedule-validate.ts`, `src/common/schedule/schedule-validate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a recorded probe result; if it fails, a validation problem `loop` on opencode tasks.

- [x] **Step 1: Input half (DONE 2026-09-27, opencode 1.18.18)**

A scripted pty (`python3`, `pty.fork`, 120×40, `TERM=xterm-256color`) started `opencode` in an empty folder and waited 8 s. It then wrote `ESC[200~…ESC[201~` without Enter:
- 2 lines: both lines appear in the input box (`┃ ZZPROBE line one ZZPROBE line two`), and the home logo stays up, so nothing was submitted.
- 60 lines: the input box shows `[Pasted ~60 lines]`, and nothing was submitted.

No model call was made and no session was created.

- [ ] **Step 2: Enter half (manual; costs one small model call)**

In an empty scratch folder, save and run:

```python
# probe-opencode-paste.py — run from an empty scratch folder: python3 probe-opencode-paste.py
import os, pty, time, select, struct, fcntl, termios
pid, fd = pty.fork()
if pid == 0:
    os.environ["TERM"] = "xterm-256color"
    os.execvp("opencode", ["opencode"])
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

def pump(sec):
    end = time.time() + sec
    while time.time() < end:
        if select.select([fd], [], [], 0.2)[0]:
            try:
                d = os.read(fd, 65536)
            except OSError:
                return
            if b"\x1b[6n" in d:
                os.write(fd, b"\x1b[1;1R")

pump(8)
body = b"\n".join(b"PROBE line %d: when you have read every line, reply with the word pong" % i for i in range(1, 61))
os.write(fd, b"\x1b[200~" + body + b"\x1b[201~")
time.sleep(0.1)
os.write(fd, b"\r")
pump(30)
os.kill(pid, 15)
```

Then find the new session with `opencode session list` and count its user messages:

```bash
opencode export <sessionID> | jq '[.messages[] | select(.info.role == "user")] | length'
opencode export <sessionID> | jq -r '[.messages[] | select(.info.role == "user")][0].parts[] | select(.type == "text") | .text' | grep -c '^PROBE line'
```

Expected: `1` and `60`, meaning one user message that holds all 60 lines. Delete the session afterwards with `opencode session delete <sessionID>`.

- [ ] **Step 3: Record the result; only if Step 2 failed, stop opencode tasks from looping**

In the spec's Risks, replace the bullet "**Pasting into opencode.** …" with the result:

> - **Pasting into opencode (probe, 2026-09-27, opencode 1.18.18).** A bracketed paste lands in the input box as one block (a 60-line paste shows as `[Pasted ~60 lines]`) and is not submitted mid-paste; Enter then sends it as one user message holding every line. The `--resume` fallback is not used.

Also append the same line to the "Probe results" list. If Step 2 returned anything other than `1` / `60`, record that result instead, and in `checkTask` of `src/common/schedule/schedule-validate.ts`, inside `if (t.loop) {`, add as the first statement:

```ts
    if (t.harness === "opencode") {
      add(t.id, "loop", "opencode tasks cannot loop yet: a pasted follow-up does not reach opencode as one prompt.");
    }
```

with this test in `schedule-validate.test.ts`:

```ts
  it("rejects a looping opencode task (opencode paste probe failed)", () => {
    const loop = { stopCriteria: "s", followUp: "f", maxIterations: 3 };
    expect(fields(sched(task("a", { harness: "opencode", loop })))).toEqual(["a:loop"]);
  });
```

Run `npx vitest run --maxWorkers=2 src/common/schedule/schedule-validate.test.ts`. Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/0018-plant-schedule.md src/common/schedule/schedule-validate.ts src/common/schedule/schedule-validate.test.ts
git commit -m "docs(schedule): opencode takes a bracketed paste as one prompt (Slice 3 probe)"
```

### Task 15: Check runner and the backend-wide check queue

**Files:**
- Create: `src/node/schedule/check-runner.ts`
- Test: `src/node/schedule/check-runner.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:

```ts
export const CHECK_TAIL_LINES = 40;
export const CHECK_KILL_GRACE_MS = 5_000;
export interface CheckRequest { command: string; cwd: string; timeoutMs: number }
export interface CheckResult { ok: boolean; tail: string }
export interface CheckOptions { shell?: string; killGraceMs?: number }
export class LineTail { constructor(max: number); push(chunk: string): void; text(): string }
export function runCheck(req: CheckRequest, o?: CheckOptions): Promise<CheckResult>;
export class CheckQueue {
  constructor(exec: (req: CheckRequest) => Promise<CheckResult>);
  run(req: CheckRequest, stillWanted: () => boolean): Promise<CheckResult | undefined>;
}
```

- [ ] **Step 1: Failing tests**

The real-process tests use `/bin/sh`, because a login zsh reads the operator's rc files, which are slow and may print. They use a 200 ms kill grace. Each one finishes in about a second.

```ts
// src/node/schedule/check-runner.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CheckQueue, LineTail, runCheck, type CheckRequest, type CheckResult } from "./check-runner.js";

const dirs: string[] = [];
const strays: number[] = [];
afterEach(async () => {
  for (const pid of strays.splice(0)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function tmp(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "spexr-check-"));
  dirs.push(d);
  return d;
}
const sh = { shell: "/bin/sh", killGraceMs: 200 };
const flush = () => new Promise((r) => setTimeout(r, 0));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
/** Polls: a killed process still answers `kill 0` until it has been reaped. */
async function goneWithin(pid: number, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return !alive(pid);
}

describe("LineTail", () => {
  it("keeps the last lines, the unfinished one included", () => {
    const t = new LineTail(3);
    t.push("a\nb\nc\n");
    t.push("d\ne");
    expect(t.text()).toBe("c\nd\ne");
  });
  it("drops colour codes", () => {
    const t = new LineTail(5);
    t.push("\x1b[31mFAIL\x1b[0m x\n");
    expect(t.text()).toBe("FAIL x");
  });
  it("bounds a line that never ends", () => {
    const t = new LineTail(5);
    for (let i = 0; i < 100; i++) t.push("x".repeat(1_000));
    expect(t.text().length).toBeLessThanOrEqual(2_000);
  });
});

describe("runCheck", () => {
  it("passes on exit 0, in the workspace", async () => {
    const cwd = await tmp();
    expect(await runCheck({ command: "pwd -P", cwd, timeoutMs: 5_000 }, sh)).toEqual({ ok: true, tail: await realpath(cwd) });
  });

  it("fails on a non-zero exit and keeps the last 40 lines", async () => {
    const cwd = await tmp();
    const r = await runCheck(
      { command: "i=0; while [ $i -lt 50 ]; do i=$((i+1)); echo line $i; done; exit 3", cwd, timeoutMs: 5_000 },
      sh,
    );
    expect(r.ok).toBe(false);
    const lines = r.tail.split("\n");
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe("line 11");
    expect(lines.at(-1)).toBe("line 50");
  });

  it("keeps what the command wrote to stderr", async () => {
    const cwd = await tmp();
    expect(await runCheck({ command: "echo oops >&2; exit 1", cwd, timeoutMs: 5_000 }, sh)).toEqual({ ok: false, tail: "oops" });
  });

  it("kills the whole process group on timeout: a child sleep is gone too", async () => {
    const cwd = await tmp();
    const pidFile = join(cwd, "child.pid");
    const r = await runCheck({ command: `sleep 30 & echo $! > '${pidFile}'; wait`, cwd, timeoutMs: 300 }, sh);
    expect(r.ok).toBe(false);
    expect(r.tail).toContain("timed out");
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    strays.push(pid);
    expect(await goneWithin(pid, 2_000)).toBe(true);
  });

  it("escalates to SIGKILL when the group ignores SIGTERM", async () => {
    const cwd = await tmp();
    const started = Date.now();
    const r = await runCheck({ command: "trap '' TERM; sleep 30", cwd, timeoutMs: 200 }, sh);
    expect(r.ok).toBe(false);
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("kills what the shell left running in its group once it exits", async () => {
    const cwd = await tmp();
    const pidFile = join(cwd, "left.pid");
    const r = await runCheck({ command: `sleep 30 & echo $! > '${pidFile}'; exit 0`, cwd, timeoutMs: 5_000 }, sh);
    expect(r.ok).toBe(true);
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    strays.push(pid);
    expect(await goneWithin(pid, 2_000)).toBe(true);
  });

  it("returns even when a process outside the group keeps the output open", async () => {
    const cwd = await tmp();
    const pidFile = join(cwd, "escaped.pid");
    const started = Date.now();
    const r = await runCheck(
      {
        command: `perl -MPOSIX -e 'POSIX::setsid(); open(my $f, ">", "${pidFile}"); print $f $$; close $f; sleep 30' & sleep 0.5; exit 0`,
        cwd,
        timeoutMs: 5_000,
      },
      sh,
    );
    expect(r.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(2_500);
    strays.push(Number((await readFile(pidFile, "utf8")).trim()));
  });

  it("reports a check that cannot start instead of throwing", async () => {
    const r = await runCheck({ command: "true", cwd: "/nonexistent-spexr-check", timeoutMs: 1_000 }, sh);
    expect(r.ok).toBe(false);
    expect(r.tail).toContain("could not start");
  });
});

describe("CheckQueue", () => {
  const req = (command: string): CheckRequest => ({ command, cwd: "/", timeoutMs: 1_000 });

  it("runs one check at a time, in the order asked, and survives a check that throws", async () => {
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const gates = new Map<string, () => void>();
    const q = new CheckQueue(async (r): Promise<CheckResult> => {
      active++;
      maxActive = Math.max(maxActive, active);
      order.push(r.command);
      await new Promise<void>((resolve) => gates.set(r.command, resolve));
      active--;
      if (r.command === "b") throw new Error("spawn blew up");
      return { ok: true, tail: r.command };
    });
    const a = q.run(req("a"), () => true);
    const b = q.run(req("b"), () => true);
    const c = q.run(req("c"), () => true);
    await flush();
    expect(order).toEqual(["a"]);
    gates.get("a")!();
    expect(await a).toEqual({ ok: true, tail: "a" });
    await flush();
    expect(order).toEqual(["a", "b"]);
    gates.get("b")!();
    await expect(b).rejects.toThrow("spawn blew up");
    await flush();
    gates.get("c")!();
    expect(await c).toEqual({ ok: true, tail: "c" });
    expect(order).toEqual(["a", "b", "c"]);
    expect(maxActive).toBe(1);
  });

  it("skips a check nobody wants any more once its turn comes", async () => {
    const ran: string[] = [];
    const q = new CheckQueue(async (r) => (ran.push(r.command), { ok: true, tail: "" }));
    let wanted = true;
    const first = q.run(req("a"), () => true);
    const second = q.run(req("b"), () => wanted);
    wanted = false; // e.g. its run was aborted while "a" ran
    await first;
    expect(await second).toBeUndefined();
    expect(ran).toEqual(["a"]);
  });

  it("two tasks' real checks never overlap (Review Focus 5)", async () => {
    const cwd = await tmp();
    const log = join(cwd, "order.log");
    const q = new CheckQueue((r) => runCheck(r, sh));
    const check = (name: string): CheckRequest => ({
      command: `echo start-${name} >> '${log}'; sleep 0.2; echo end-${name} >> '${log}'`,
      cwd,
      timeoutMs: 5_000,
    });
    await Promise.all([q.run(check("a"), () => true), q.run(check("b"), () => true)]);
    expect((await readFile(log, "utf8")).trim().split("\n")).toEqual(["start-a", "end-a", "start-b", "end-b"]);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/check-runner.test.ts`
Expected: FAIL. `Cannot find module './check-runner.js'`.

- [ ] **Step 3: Implement**

```ts
// src/node/schedule/check-runner.ts
import { spawn, type ChildProcess } from "node:child_process";

/** Lines of a failed check's output carried into the follow-up (spec, Turn end and convergence). */
export const CHECK_TAIL_LINES = 40;
/** Time a check's process group gets between SIGTERM and SIGKILL once it has timed out. */
export const CHECK_KILL_GRACE_MS = 5_000;
/** After the shell exits, how long its output may still drain before the result is taken. */
const DRAIN_MS = 500;
/** A longer line is cut: output with no newline must not grow without bound. */
const MAX_LINE_CHARS = 2_000;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

export interface CheckRequest {
  command: string;
  cwd: string;
  timeoutMs: number;
}

export interface CheckResult {
  ok: boolean;
  /** The last CHECK_TAIL_LINES lines of stdout and stderr, in arrival order, colour codes removed. */
  tail: string;
}

export interface CheckOptions {
  /** Defaults to `$SHELL`, else `/bin/sh`. */
  shell?: string;
  killGraceMs?: number;
}

/** Keeps the last `max` lines of a text stream; the unfinished last line counts as one. */
export class LineTail {
  private lines: string[] = [];
  private partial = "";

  constructor(private readonly max: number) {}

  push(chunk: string): void {
    const parts = (this.partial + chunk).split(/\r?\n/);
    this.partial = parts.pop()!.slice(-MAX_LINE_CHARS);
    for (const p of parts) this.lines.push(p.slice(0, MAX_LINE_CHARS));
    if (this.lines.length > this.max) this.lines = this.lines.slice(-this.max);
  }

  text(): string {
    const all = this.partial ? [...this.lines, this.partial] : this.lines;
    return all.slice(-this.max).join("\n").replace(ANSI, "");
  }
}

/**
 * Run a task's check command: `<shell> -l -c <command>` in the workspace, as
 * the leader of its own process group. On timeout the whole group gets SIGTERM,
 * then SIGKILL after the grace. Once the shell exits, whatever it left in its
 * group is killed as well, so nothing overlaps the next check. The result is
 * taken on exit plus a short drain, never on the pipes closing alone: a process
 * that left the group can hold them open for ever. Never rejects.
 */
export function runCheck(req: CheckRequest, o: CheckOptions = {}): Promise<CheckResult> {
  const shell = o.shell ?? process.env.SHELL ?? "/bin/sh";
  const grace = o.killGraceMs ?? CHECK_KILL_GRACE_MS;
  return new Promise((resolve) => {
    const tail = new LineTail(CHECK_TAIL_LINES);
    let child: ChildProcess;
    try {
      child = spawn(shell, ["-l", "-c", req.command], {
        cwd: req.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      resolve({ ok: false, tail: `The check could not start: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    let timedOut = false;
    let settled = false;
    const killGroup = (signal: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        /* ESRCH: the group is already gone */
      }
    };
    const finish = (ok: boolean, note?: string): void => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (note) tail.push(`\n${note}\n`);
      resolve({ ok, tail: tail.text() });
    };
    child.stdout?.setEncoding("utf8").on("data", (d: string) => tail.push(d));
    child.stderr?.setEncoding("utf8").on("data", (d: string) => tail.push(d));
    child.once("error", (err) => finish(false, `The check could not start: ${err.message}`));
    timers.push(
      setTimeout(() => {
        timedOut = true;
        killGroup("SIGTERM");
        timers.push(setTimeout(() => killGroup("SIGKILL"), grace));
      }, req.timeoutMs),
    );
    child.once("exit", (code) => {
      killGroup("SIGKILL");
      const done = (): void =>
        finish(
          !timedOut && code === 0,
          timedOut ? `[the check timed out after ${req.timeoutMs / 1000} s and was stopped]` : undefined,
        );
      child.once("close", done);
      timers.push(setTimeout(done, DRAIN_MS));
    });
  });
}

/**
 * Runs checks one at a time, in the order they were asked for. One instance
 * serves the whole backend: parallel tasks each running `pnpm test` at once
 * would overload the machine (it crashed on 2026-09-24). `stillWanted` is asked
 * when a check's turn comes; false skips it (its run was aborted meanwhile).
 */
export class CheckQueue {
  private last: Promise<unknown> = Promise.resolve();

  constructor(private readonly exec: (req: CheckRequest) => Promise<CheckResult>) {}

  run(req: CheckRequest, stillWanted: () => boolean): Promise<CheckResult | undefined> {
    const next = this.last.then(() => (stillWanted() ? this.exec(req) : undefined));
    this.last = next.catch(() => undefined);
    return next;
  }
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/check-runner.test.ts`
Expected: PASS, about 11 tests in under 5 s.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `pnpm run lint && pnpm run typecheck`
Expected: clean.

```bash
git add src/node/schedule/check-runner.ts src/node/schedule/check-runner.test.ts
git commit -m "feat(schedule): check runner killed by process group, one check at a time backend-wide"
```

### Task 16: Paste with Enter, and re-arming the watchers after a paste

**Files:**
- Modify: `src/node/schedule/schedule-pty.ts`, test `src/node/schedule/schedule-pty.test.ts`
- Modify: `src/node/schedule/turn-tracker.ts`, test `src/node/schedule/turn-tracker.test.ts`
- Modify: `src/node/schedule/claude-task-watcher.ts`, test `src/node/schedule/claude-task-watcher.test.ts`
- Modify: `src/node/schedule/opencode-task-watcher.ts`, test `src/node/schedule/opencode-task-watcher.test.ts`
- Modify: `src/node/schedule/schedule-runner.ts`, test `src/node/schedule/schedule-runner.test.ts` (return type of the watch ports only)

**Interfaces:**
- Consumes: `TurnTracker` and `finalReply` (Task 7), both watchers (Tasks 8–9), `RunnerPorts` (Task 11).
- Produces:

```ts
// schedule-pty.ts
export const PASTE_ENTER_DELAY_MS = 100;
export function bracketedPaste(text: string): string;
export function pasteInto(write: (data: string) => void, text: string, sleep: (ms: number) => Promise<void>): Promise<void>;
// SchedulePty
paste(terminalId: number, text: string): Promise<void>;
// turn-tracker.ts
export function isPrompt(e: StateEntry): boolean;   // was private
// TurnTracker
arm(): void;
// claude-task-watcher.ts
export interface TaskWatch { stop(): void; arm(): void }
export function watchClaudeTask(req, deps, listener): TaskWatch;       // was () => void
// opencode-task-watcher.ts
export function watchOpencodeTask(req, source, deps, listener): TaskWatch; // was () => void
// schedule-runner.ts — RunnerPorts
watchClaude(req, listener): TaskWatch;
watchOpencode(req, listener): TaskWatch;
```

- [ ] **Step 1: Failing tests for the paste**

Append to `src/node/schedule/schedule-pty.test.ts`, and extend its import to `import { bracketedPaste, pasteInto, withoutClaudeSessionMarkers } from "./schedule-pty.js";`:

```ts
describe("bracketedPaste", () => {
  it("wraps the text so the TUI takes it as one paste", () => {
    expect(bracketedPaste("fix it\nthen test")).toBe("\x1b[200~fix it\nthen test\x1b[201~");
  });
  it("cannot be broken out of: control sequences in the text are dropped (R2)", () => {
    const out = bracketedPaste("Check failed:\nFAIL\x1b[201~/exit\r\x1b[31mred\x07\ttab\r\nend");
    expect(out).toBe("\x1b[200~Check failed:\nFAIL[201~/exit\n[31mred\ttab\nend\x1b[201~");
    expect(out.indexOf("\x1b[201~")).toBe(out.length - 6);
    expect(out).not.toContain("\r");
  });
});

describe("pasteInto", () => {
  it("pastes, waits, then presses Enter", async () => {
    const writes: string[] = [];
    const waits: number[] = [];
    await pasteInto((d) => writes.push(d), "go", async (ms) => void waits.push(ms));
    expect(writes).toEqual(["\x1b[200~go\x1b[201~", "\r"]);
    expect(waits).toEqual([100]);
  });
});
```

- [ ] **Step 2: Failing tests for arm()**

Append inside `describe("TurnTracker", …)` in `src/node/schedule/turn-tracker.test.ts`:

```ts
  it("arm() makes the next ended reading count, once", () => {
    const t = new TurnTracker({ settleMs: 0 });
    t.update("acting", 0);
    expect(t.update("ended", 1)).toEqual([{ type: "turn-ended" }]);
    expect(t.update("ended", 2)).toEqual([]);
    t.arm();
    expect(t.update("ended", 3)).toEqual([{ type: "turn-ended" }]);
    expect(t.update("ended", 4)).toEqual([]);
  });
```

In `src/node/schedule/claude-task-watcher.test.ts`, change the harness so it exposes the handle. Replace:

```ts
  const stop = watchClaudeTask(
```
with
```ts
  const watch = watchClaudeTask(
```
and, in the harness's returned object, replace `    stop,` with `    watch,`. Then append inside `describe("watchClaudeTask", …)`:

```ts
  const ends = (events: WatchEvent[]): string[] =>
    events.flatMap((e) => (e.type === "turn-ended" ? [e.reply] : []));
  const user = (content: string) => L({ message: { role: "user", content } });
  const said = (text: string) => L({ message: { role: "assistant", content: [{ type: "text", text }] } });

  it("after a paste, never counts the reply still on screen again (re-arm, R1)", async () => {
    let batch: string[] | undefined = [user("p"), said("one")];
    const h = harness(() => batch);
    await h.advance(1_000);
    batch = [];
    expect(ends(h.events)).toEqual(["one"]);
    h.watch.arm();
    await h.advance(1_000);
    await h.advance(1_000);
    expect(ends(h.events)).toEqual(["one"]);
  });

  it("after a paste, counts a fast reply once even if the agent was never seen working (re-arm, R1)", async () => {
    let batch: string[] | undefined = [user("p"), said("one")];
    const h = harness(() => batch);
    await h.advance(1_000);
    batch = [];
    h.watch.arm();
    await h.advance(1_000);
    batch = [user("follow-up"), said("two")]; // prompt and reply land between two reads
    await h.advance(1_000);
    batch = [];
    await h.advance(1_000);
    expect(ends(h.events)).toEqual(["one", "two"]);
  });
```

In `src/node/schedule/opencode-task-watcher.test.ts`, in the test "delivers nothing after stop(), …", replace `const stop = watchOpencodeTask(` with `const watch = watchOpencodeTask(` and replace the line `    stop();` with `    watch.stop();`. Then append inside `describe("watchOpencodeTask", …)`:

```ts
  it("after a paste, counts the next turn end only once the scan shows a newer prompt (re-arm, R1)", async () => {
    const src = source();
    const events: WatchEvent[] = [];
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const turnEnds = () => events.filter((e) => e.type === "turn-ended").length;
    const watch = watchOpencodeTask({ workspace: "/repo" }, src.s, { now: () => 0, every: () => () => {} }, (e) =>
      events.push(e),
    );
    src.emit([tile("new", "/repo", { state: "idle", needsYou: true, turnCount: 1 })]);
    await flush();
    expect(turnEnds()).toBe(1);
    watch.arm();
    src.emit([tile("new", "/repo", { state: "idle", needsYou: true, turnCount: 1 })]); // the old reply, still on screen
    await flush();
    expect(turnEnds()).toBe(1);
    src.emit([tile("new", "/repo", { state: "idle", needsYou: true, turnCount: 2 })]); // answered between two scans
    await flush();
    expect(turnEnds()).toBe(2);
    src.emit([tile("new", "/repo", { state: "idle", needsYou: true, turnCount: 2 })]);
    await flush();
    expect(turnEnds()).toBe(2);
  });
```

- [ ] **Step 3: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-pty.test.ts src/node/schedule/turn-tracker.test.ts src/node/schedule/claude-task-watcher.test.ts src/node/schedule/opencode-task-watcher.test.ts`
Expected: FAIL. `bracketedPaste`/`pasteInto` are not exported, `t.arm is not a function`, and `h.watch.arm` / `watch.arm` / `watch.stop` are not functions.

- [ ] **Step 4: Implement the paste**

In `src/node/schedule/schedule-pty.ts`, after `withoutClaudeSessionMarkers`, add:

```ts
/** Wait between a paste and the Enter that submits it, so the TUI has taken the paste in (probe, 2026-09-27). */
export const PASTE_ENTER_DELAY_MS = 100;

/**
 * `text` as one bracketed paste. CR becomes LF, and every other control
 * character but LF and tab is dropped first — above all ESC, so `ESC[201~`
 * cannot end the paste early and turn the rest into keystrokes. The text can
 * carry a check's output, which comes from code the agent wrote.
 */
export function bracketedPaste(text: string): string {
  const clean = text.replace(/\r\n?/g, "\n").replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");
  return `\x1b[200~${clean}\x1b[201~`;
}

/** Paste `text`, then press Enter once the TUI has taken the paste in. */
export async function pasteInto(
  write: (data: string) => void,
  text: string,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  write(bracketedPaste(text));
  await sleep(PASTE_ENTER_DELAY_MS);
  write("\r");
}
```

and in `class SchedulePty`, after `write(…)`:

```ts
  /** Paste a follow-up into a task's TUI and submit it as one prompt. */
  paste(terminalId: number, text: string): Promise<void> {
    return pasteInto(
      (data) => this.write(terminalId, data),
      text,
      (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    );
  }
```

- [ ] **Step 5: Implement arm() on the tracker**

In `src/node/schedule/turn-tracker.ts`, change `function isPrompt(` to `export function isPrompt(`, and add this method to `TurnTracker`, after `update`:

```ts
  /**
   * Count the next ended reading as a turn end even if no work was seen
   * before it. Only a caller that knows a new prompt has arrived may call
   * this — the watchers do, once their prompt count has gone up after a paste.
   */
  arm(): void {
    this.armed = true;
  }
```

- [ ] **Step 6: Implement the Claude watcher's handle**

In `src/node/schedule/claude-task-watcher.ts`, change the import to `import { TurnTracker, finalReply, isPrompt, type TurnSignal } from "./turn-tracker.js";`. After the `WatchEvent` type, add:

```ts
/** A running task watch. */
export interface TaskWatch {
  stop(): void;
  /**
   * Call just before pasting a prompt. The next turn end counts once a prompt
   * newer than this call shows up — even if the agent was never seen working
   * (a reply that lands between two reads). The reply already on screen never
   * counts again.
   */
  arm(): void;
}
```

and replace the whole `watchClaudeTask` function with:

```ts
/**
 * Follow one scheduled Claude session: wait for its transcript (reporting
 * needs-you after CLAUDE_STARTUP_PROMPT_MS — the pty exiting is what fails the
 * task), then read what it gains every second and report turn transitions.
 */
export function watchClaudeTask(
  req: { sessionId: string; configDir: string; permissionMode?: string },
  deps: ClaudeWatchDeps,
  listener: (e: WatchEvent) => void,
): TaskWatch {
  const startedAt = deps.now();
  const tracker = new TurnTracker({
    ...(req.permissionMode !== undefined ? { permissionMode: req.permissionMode } : {}),
    settleMs: SETTLE_MS,
    armed: true,
  });
  let path: string | undefined;
  let cursor: FollowCursor | undefined;
  let entries: StateEntry[] = [];
  let waitingAtStartup = false;
  // Counted as lines arrive: `entries` is trimmed to KEEP_ENTRIES, so its
  // length cannot serve as the baseline arm() compares against.
  let promptsSeen = 0;
  let armAfter: number | undefined;
  const stop = deps.every(async () => {
    if (!path) {
      path = await deps.find(req.configDir, req.sessionId);
      if (!path) {
        if (!waitingAtStartup && deps.now() - startedAt >= CLAUDE_STARTUP_PROMPT_MS) {
          waitingAtStartup = true;
          listener({ type: "needs-you" });
        }
        return;
      }
      listener({ type: "session-found", sessionId: req.sessionId });
      if (waitingAtStartup) listener({ type: "resumed-working" });
    }
    const chunk = await deps.read(path, cursor, FIRST_READ_BYTES);
    cursor = chunk.cursor;
    for (const line of chunk.lines) {
      let entry: StateEntry;
      try {
        entry = JSON.parse(line) as StateEntry;
      } catch {
        continue; // a malformed line is dropped; readFollowChunk already holds back torn ones
      }
      entries.push(entry);
      if (entry && isPrompt(entry)) promptsSeen++;
    }
    if (entries.length > KEEP_ENTRIES) entries = entries.slice(-KEEP_ENTRIES);
    if (armAfter !== undefined && promptsSeen > armAfter) {
      tracker.arm();
      armAfter = undefined;
    }
    for (const signal of tracker.update(lastTurn(entries), deps.now())) {
      listener(signal.type === "turn-ended" ? { type: "turn-ended", reply: finalReply(entries) } : signal);
    }
  });
  return {
    stop,
    arm: () => {
      armAfter = promptsSeen;
    },
  };
}
```

- [ ] **Step 7: Implement the opencode watcher's handle**

In `src/node/schedule/opencode-task-watcher.ts`, change the import to `import type { TaskWatch, WatchEvent } from "./claude-task-watcher.js";` and replace the whole `watchOpencodeTask` function with:

```ts
/**
 * Watch an opencode task through the wall's scans: adopt the first session in
 * its folder that the wall did not know at launch, then report its turn
 * transitions. Asks for a scan every SCAN_EVERY_MS so it moves with no window open.
 * After arm(), the next turn end counts once the tile's prompt count
 * (`turnCount`) has gone up: with a scan every 20 s, the reply to a pasted
 * follow-up usually lands without the agent ever being seen working.
 */
export function watchOpencodeTask(
  req: { workspace: string; permissionMode?: string },
  source: WallScanSource,
  deps: { now(): number; every(fn: () => Promise<void>): () => void },
  listener: (e: WatchEvent) => void,
): TaskWatch {
  const known = source.knownSessionIds();
  const startedAt = deps.now();
  const tracker = new TurnTracker({
    ...(req.permissionMode !== undefined ? { permissionMode: req.permissionMode } : {}),
    settleMs: 0,
    armed: true,
  });
  let sessionId: string | undefined;
  let stopped = false;
  let turnsSeen = 0;
  let armAfter: number | undefined;
  const stopScans = deps.every(async () => source.requestScan());
  const stopListening = source.onScanned((tiles) => {
    if (stopped) return;
    if (!sessionId) {
      const found = tiles.find((t) => t.harness === "opencode" && norm(t.projectPath) === norm(req.workspace) && !known.has(t.sessionId));
      if (!found) {
        if (deps.now() - startedAt >= OPENCODE_SESSION_WAIT_MS) {
          stop();
          listener({ type: "session-missing" });
        }
        return;
      }
      sessionId = found.sessionId;
      listener({ type: "session-found", sessionId });
    }
    const mine = tiles.find((t) => t.sessionId === sessionId);
    if (!mine) return;
    turnsSeen = mine.turnCount ?? 0;
    if (armAfter !== undefined && turnsSeen > armAfter) {
      tracker.arm();
      armAfter = undefined;
    }
    for (const signal of tracker.update(turnOf(mine), deps.now())) {
      if (signal.type !== "turn-ended") listener(signal);
      else
        void source.scanEntries(sessionId).then((entries) => {
          if (!stopped) listener({ type: "turn-ended", reply: finalReply(entries as StateEntry[]) });
        });
    }
  });
  function stop(): void {
    stopped = true;
    stopScans();
    stopListening();
  }
  return {
    stop,
    arm: () => {
      armAfter = turnsSeen;
    },
  };
}
```

- [ ] **Step 8: Carry the handle through the runner's ports**

In `src/node/schedule/schedule-runner.ts`:
- Replace `import type { WatchEvent } from "./claude-task-watcher.js";` with `import type { TaskWatch, WatchEvent } from "./claude-task-watcher.js";`.
- In `RunnerPorts`, change the return type `(): () => void;` of both `watchClaude(…)` and `watchOpencode(…)` to `: TaskWatch;`.
- In `perform`, replace `const stopWatch =` with `const watch =` and `registered.push(stopWatch);` with `registered.push(() => watch.stop());`.

`spexr-schedule-backend-service.ts` needs no change: its ports already return what the watchers return.

In `src/node/schedule/schedule-runner.test.ts`, make every fake return a handle:
- In `fakes()`: replace `watchClaude: (_req, l) => ((watch = l), () => (watch = undefined)),` with `watchClaude: (_req, l) => ((watch = l), { stop: () => (watch = undefined), arm: () => {} }),`, and `watchOpencode: () => () => {},` with `watchOpencode: () => ({ stop: () => {}, arm: () => {} }),`.
- In "does not bind a rerun's task…": replace `return () => stopped.push(req.sessionId);` with `return { stop: () => stopped.push(req.sessionId), arm: () => {} };`.
- In "fails the task when registering its exit listener throws…": replace `f.ports.watchClaude = () => () => (watchStopped = true);` with `f.ports.watchClaude = () => ({ stop: () => (watchStopped = true), arm: () => {} });`.
- In "drops a superseded run's late started event…": replace ``return () => registrations.push(`unwatch:${req.sessionId}`);`` with ``return { stop: () => registrations.push(`unwatch:${req.sessionId}`), arm: () => {} };``.

- [ ] **Step 9: Run to see them pass**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/`
Expected: PASS, including the existing Review Focus 1 test "does not report the same ended turn twice".

- [ ] **Step 10: Lint, typecheck, commit**

Run: `pnpm run lint && pnpm run typecheck`
Expected: clean.

```bash
git add src/node/schedule/
git commit -m "feat(schedule): paste-then-Enter port and watcher re-arm after a paste (one turn never counts twice)"
```

### Task 17: Loop validation (check command, timeout, placeholders)

**Files:**
- Modify: `src/common/schedule/schedule-types.ts`
- Modify: `src/common/schedule/schedule-validate.ts`
- Test: `src/common/schedule/schedule-validate.test.ts`

**Interfaces:**
- Consumes: `placeholdersIn` (Task 2).
- Produces: `MAX_CHECK_TIMEOUT_SEC = 3_600`; new problems `loop.check`, `loop.checkTimeoutSec`, and `loop.followUp` (placeholders).

- [ ] **Step 1: Failing test**

Append inside `describe("validateSchedule", …)` in `schedule-validate.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --maxWorkers=2 src/common/schedule/schedule-validate.test.ts`
Expected: FAIL. The first assertion receives `[]`.

- [ ] **Step 3: Implement**

In `schedule-types.ts`, after `DEFAULT_CHECK_TIMEOUT_SEC`:

```ts
/** A check longer than an hour is not a gate a loop should wait on. */
export const MAX_CHECK_TIMEOUT_SEC = 3_600;
```

In `schedule-validate.ts`, add `MAX_CHECK_TIMEOUT_SEC` to the import from `./schedule-types.js`, and in `checkTask` replace the `if (t.loop) { … }` block with:

```ts
  if (t.loop) {
    const { maxIterations, stopCriteria, followUp, check, checkTimeoutSec } = t.loop;
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
      add(t.id, "loop.maxIterations", `Between 1 and ${MAX_ITERATIONS}.`);
    }
    if (!stopCriteria.trim()) add(t.id, "loop.stopCriteria", "Say when the task is done.");
    if (!followUp.trim()) add(t.id, "loop.followUp", "Write what to send on each new iteration.");
    else if (placeholdersIn(followUp).length > 0) {
      add(t.id, "loop.followUp", "Placeholders go in the prompt: the follow-up is pasted as written.");
    }
    if (check !== undefined) {
      if (!check.trim()) add(t.id, "loop.check", "Write the command, or remove the check.");
      else if (placeholdersIn(check).length > 0) {
        add(t.id, "loop.check", "Placeholders are not filled in here: the check runs exactly as written.");
      }
    }
    if (
      checkTimeoutSec !== undefined &&
      (!Number.isInteger(checkTimeoutSec) || checkTimeoutSec < 1 || checkTimeoutSec > MAX_CHECK_TIMEOUT_SEC)
    ) {
      add(t.id, "loop.checkTimeoutSec", `Between 1 and ${MAX_CHECK_TIMEOUT_SEC} seconds.`);
    }
  }
```

(If Task 14 Step 3 added the opencode rule, keep it as the first statement of this block.)

- [ ] **Step 4: Run to see it pass**

Run: `npx vitest run --maxWorkers=2 src/common/schedule/`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `pnpm run lint && pnpm run typecheck`
Expected: clean.

```bash
git add src/common/schedule/schedule-types.ts src/common/schedule/schedule-validate.ts src/common/schedule/schedule-validate.test.ts
git commit -m "feat(schedule): validate the loop's check command, its timeout, and placeholder-free follow-ups"
```

### Task 18: The engine loops — check, follow-up, iterations, pause and resume

**Files:**
- Modify: `src/common/schedule/schedule-types.ts` (`TaskRunState.checkTail`, doc of `pausedBy`)
- Modify: `src/node/schedule/schedule-engine.ts`
- Test: `src/node/schedule/schedule-engine.test.ts`

**Interfaces:**
- Consumes: `followUpPrompt`, `hasConverged` (Task 2); `DEFAULT_CHECK_TIMEOUT_SEC` (Task 1).
- Produces:

```ts
export type EngineEvent =
  | …Slice 2 events…
  | { type: "check-done"; task: string; ok: boolean; tail: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "abort" }
  | { type: "recover" };

export type Effect =
  | { type: "start"; task: string; prompt: string }
  | { type: "name"; sessionId: string; name: string }
  | { type: "paste"; task: string; terminalId: number; text: string }
  | { type: "check"; task: string; command: string; cwd: string; timeoutSec: number };
```

- [ ] **Step 1: Failing tests**

Change the imports at the top of `schedule-engine.test.ts` to:

```ts
import { describe, expect, it } from "vitest";
import type { RunState, Schedule, ScheduleTask, TaskLaunch } from "../../common/schedule/schedule-types.js";
import { firstPrompt, followUpPrompt } from "../../common/schedule/schedule-prompt.js";
import { startRun, step } from "./schedule-engine.js";
```

and append:

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-engine.test.ts`
Expected: FAIL. On the paste test, the looping task `converged` on its first turn end (Slice 2 behaviour), and `check-done`/`pause`/`resume` are not handled.

- [ ] **Step 3: Types**

In `schedule-types.ts`, in `TaskRunState`, after `reply?: string;` add:

```ts
  /** A failed check's output, kept while its follow-up is held by an operator pause. */
  checkTail?: string;
```

and replace the doc comment of `RunState.pausedBy` with:

```ts
  /**
   * Set while no new task may start. "operator": the operator paused the run
   * (turn ends are held too); it wins over a failure and resume() recomputes
   * the failure pause from the task statuses. "failure": a task is failed or
   * interrupted.
   */
```

- [ ] **Step 4: Implement the engine**

Replace `src/node/schedule/schedule-engine.ts` with:

```ts
import {
  ACTIVE_STATUSES,
  DEFAULT_CHECK_TIMEOUT_SEC,
  SETTLED_STATUSES,
  type RunState,
  type Schedule,
  type ScheduleTask,
  type TaskLaunch,
} from "../../common/schedule/schedule-types.js";
import {
  fillPlaceholders,
  firstPrompt,
  followUpPrompt,
  hasConverged,
  stripMarker,
} from "../../common/schedule/schedule-prompt.js";

export type EngineEvent =
  | { type: "started"; task: string; terminalId: number; processId: number; workspace: string; sessionId?: string }
  | { type: "start-failed"; task: string; error: string }
  | { type: "session-found"; task: string; sessionId: string }
  | { type: "session-missing"; task: string }
  | { type: "turn-ended"; task: string; reply: string }
  | { type: "needs-you"; task: string }
  | { type: "resumed-working"; task: string }
  | { type: "exited"; task: string }
  | { type: "check-done"; task: string; ok: boolean; tail: string }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "abort" }
  | { type: "recover" };

export type Effect =
  | { type: "start"; task: string; prompt: string }
  | { type: "name"; sessionId: string; name: string }
  | { type: "paste"; task: string; terminalId: number; text: string }
  | { type: "check"; task: string; command: string; cwd: string; timeoutSec: number };

export interface StepResult {
  run: RunState;
  effects: Effect[];
}

/** The wall card's label for a task: `<schedule> · <task> (<iteration>/<max>)`. */
export function sessionName(schedule: Schedule, taskId: string, iteration: number): string {
  const t = schedule.tasks.find((x) => x.id === taskId);
  return `${schedule.name} · ${t?.name ?? taskId} (${iteration}/${t?.loop?.maxIterations ?? 1})`;
}

/** A new run with every task pending, and the first ready tasks started. */
export function startRun(schedule: Schedule, launches: Record<string, TaskLaunch>, runId: string, nowMs: number): StepResult {
  const run: RunState = {
    scheduleId: schedule.id,
    runId,
    status: "running",
    startedAtMs: nowMs,
    tasks: Object.fromEntries(schedule.tasks.map((t) => [t.id, { status: "pending" as const, iteration: 0 }])),
    launches,
  };
  const effects: Effect[] = [];
  advance(schedule, run, effects);
  return { run, effects };
}

/**
 * Apply one event to a run: pure, never mutates its input. Returns the new run
 * and the effects the runner must perform. Events for a task in a state they
 * do not apply to are ignored, so a late watcher signal cannot resurrect a task.
 */
export function step(schedule: Schedule, prev: RunState, event: EngineEvent): StepResult {
  const run = structuredClone(prev);
  const effects: Effect[] = [];
  if (run.status !== "running") return { run, effects };
  const task = "task" in event ? run.tasks[event.task] : undefined;
  switch (event.type) {
    case "started":
      if (task?.status !== "starting") break;
      Object.assign(task, {
        status: "running",
        terminalId: event.terminalId,
        processId: event.processId,
        workspace: event.workspace,
      });
      // Claude's id is chosen before launch: recording it now lets a window
      // recognise the task's card from its first second (no duplicate card).
      if (event.sessionId) task.sessionId = event.sessionId;
      break;
    case "session-found":
      if (!task || !ACTIVE_STATUSES.has(task.status)) break;
      task.sessionId = event.sessionId;
      effects.push({ type: "name", sessionId: event.sessionId, name: sessionName(schedule, event.task, task.iteration) });
      break;
    case "start-failed":
      if (task?.status === "starting") fail(run, event.task, event.error);
      break;
    case "session-missing":
      if (task && ACTIVE_STATUSES.has(task.status)) fail(run, event.task, "The session's transcript never appeared.");
      break;
    case "exited":
      if (task && ACTIVE_STATUSES.has(task.status)) fail(run, event.task, "The session ended before the task converged.");
      break;
    case "turn-ended":
      if (task?.status === "held") {
        // The operator typed into the card while paused: the newer reply is the one to judge.
        task.reply = event.reply;
        delete task.checkTail;
        break;
      }
      if (task?.status !== "running" && task?.status !== "waiting-on-you") break;
      if (run.pausedBy === "operator") {
        task.status = "held";
        task.reply = event.reply;
        break;
      }
      turnEnded(schedule, run, event.task, event.reply, effects);
      break;
    case "check-done":
      if (task?.status !== "checking") break;
      if (event.ok) task.status = "converged";
      else if (run.pausedBy === "operator") {
        task.status = "held";
        task.checkTail = event.tail;
      } else iterate(schedule, run, event.task, event.tail, effects);
      break;
    case "needs-you":
      if (task?.status === "running") task.status = "waiting-on-you";
      break;
    case "resumed-working":
      if (task?.status === "waiting-on-you") task.status = "running";
      break;
    case "pause":
      run.pausedBy = "operator";
      break;
    case "resume":
      if (run.pausedBy !== "operator") return { run, effects };
      if (hasFailure(run)) run.pausedBy = "failure";
      else delete run.pausedBy;
      for (const t of schedule.tasks) {
        const held = run.tasks[t.id];
        if (held?.status !== "held") continue;
        if (held.checkTail !== undefined) iterate(schedule, run, t.id, held.checkTail, effects);
        else turnEnded(schedule, run, t.id, held.reply ?? "", effects);
      }
      break;
    case "abort":
      run.status = "aborted";
      return { run, effects };
    case "recover":
      for (const t of Object.values(run.tasks)) if (ACTIVE_STATUSES.has(t.status)) t.status = "interrupted";
      if (Object.values(run.tasks).some((t) => t.status === "interrupted")) run.pausedBy = "failure";
      return { run, effects };
  }
  advance(schedule, run, effects);
  return { run, effects };
}

function taskOf(schedule: Schedule, taskId: string): ScheduleTask {
  return schedule.tasks.find((t) => t.id === taskId)!;
}

/** Judge a finished turn: converge, run the check, or go round again. */
function turnEnded(schedule: Schedule, run: RunState, taskId: string, reply: string, effects: Effect[]): void {
  const t = taskOf(schedule, taskId);
  const state = run.tasks[taskId]!;
  state.reply = reply;
  delete state.checkTail;
  if (!t.loop) {
    state.status = "converged";
    return;
  }
  if (!hasConverged(reply)) {
    iterate(schedule, run, taskId, undefined, effects);
    return;
  }
  const check = t.loop.check;
  if (!check?.trim()) {
    state.status = "converged";
    return;
  }
  state.status = "checking";
  // Verbatim: placeholders are never filled into a check command (spec, Hand-off).
  effects.push({
    type: "check",
    task: taskId,
    command: check,
    cwd: state.workspace ?? t.project,
    timeoutSec: t.loop.checkTimeoutSec ?? DEFAULT_CHECK_TIMEOUT_SEC,
  });
}

/** Paste the follow-up (with a failed check's output) for one more iteration, or fail once none are left. */
function iterate(schedule: Schedule, run: RunState, taskId: string, checkTail: string | undefined, effects: Effect[]): void {
  const t = taskOf(schedule, taskId);
  const state = run.tasks[taskId]!;
  delete state.checkTail;
  const max = t.loop?.maxIterations ?? 1;
  if (state.iteration >= max) {
    fail(
      run,
      taskId,
      `Not converged after ${max} iteration${max === 1 ? "" : "s"}${checkTail === undefined ? "" : ": the check still fails"}.`,
    );
    return;
  }
  state.iteration += 1;
  state.status = "running";
  if (state.sessionId) {
    effects.push({ type: "name", sessionId: state.sessionId, name: sessionName(schedule, taskId, state.iteration) });
  }
  effects.push({
    type: "paste",
    task: taskId,
    terminalId: state.terminalId!,
    text: followUpPrompt(t, checkTail === undefined ? undefined : { command: t.loop!.check!, tail: checkTail }),
  });
}

function hasFailure(run: RunState): boolean {
  return Object.values(run.tasks).some((t) => t.status === "failed" || t.status === "interrupted");
}

/** Fail a task; the run pauses on the failure unless the operator's pause already holds it. */
function fail(run: RunState, taskId: string, error: string): void {
  const t = run.tasks[taskId]!;
  t.status = "failed";
  t.error = error;
  if (run.pausedBy !== "operator") run.pausedBy = "failure";
}

function ready(schedule: Schedule, run: RunState): ScheduleTask[] {
  return schedule.tasks.filter(
    (t) => run.tasks[t.id]?.status === "pending" && t.needs.every((n) => SETTLED_STATUSES.has(run.tasks[n]?.status ?? "pending")),
  );
}

/** Start what is ready (unless paused) and finish the run once everything has settled. */
function advance(schedule: Schedule, run: RunState, effects: Effect[]): void {
  if (!run.pausedBy) {
    for (const t of ready(schedule, run)) {
      run.tasks[t.id] = { status: "starting", iteration: 1 };
      const filled = fillPlaceholders(t.prompt, (id, field) =>
        field === "reply" ? stripMarker(run.tasks[id]?.reply ?? "") : run.tasks[id]?.workspace,
      );
      effects.push({ type: "start", task: t.id, prompt: firstPrompt(t, filled) });
    }
  }
  if (schedule.tasks.every((t) => SETTLED_STATUSES.has(run.tasks[t.id]?.status ?? "pending"))) run.status = "finished";
}
```

(`resume` without an operator pause returns the unchanged clone and skips `advance`, which is what "resume without a pause changes nothing" pins.)

- [ ] **Step 5: Run to see them pass**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-engine.test.ts src/node/schedule/schedule-runner.test.ts`
Expected: PASS. The Slice 2 engine and runner tests are unchanged and still pass: a task without `loop` converges on its first turn end.

- [ ] **Step 6: Lint, typecheck, commit**

Run: `pnpm run lint && pnpm run typecheck`
Expected: clean.

```bash
git add src/common/schedule/schedule-types.ts src/node/schedule/schedule-engine.ts src/node/schedule/schedule-engine.test.ts
git commit -m "feat(schedule): engine loops until converged — check, follow-up, iteration limit, pause and resume (AC-9..AC-11)"
```

### Task 19: Runner and service — paste, check, pause, resume

**Files:**
- Modify: `src/common/schedule/schedule-protocol.ts`
- Modify: `src/node/schedule/schedule-runner.ts`
- Test: `src/node/schedule/schedule-runner.test.ts`
- Modify: `src/node/schedule/spexr-schedule-backend-service.ts`

**Interfaces:**
- Consumes: `CheckQueue`, `runCheck`, `CheckRequest`, `CheckResult` (Task 15); `SchedulePty.paste`, `TaskWatch` (Task 16); the engine's `paste`/`check` effects and `check-done`/`pause`/`resume` events (Task 18).
- Produces:

```ts
// SpexrScheduleService (schedule-protocol.ts)
pause(scheduleId: string): Promise<void>;
resume(scheduleId: string): Promise<void>;
// RunnerPorts
paste(terminalId: number, text: string): Promise<void>;
check(req: CheckRequest, stillWanted: () => boolean): Promise<CheckResult | undefined>;
// ScheduleRunner
pause(scheduleId: string): Promise<void>;
resume(scheduleId: string): Promise<void>;
```

- [ ] **Step 1: Failing tests**

In `schedule-runner.test.ts`, add these imports:

```ts
import type { CheckRequest, CheckResult } from "./check-runner.js";
import { followUpPrompt } from "../../common/schedule/schedule-prompt.js";
```

and replace the whole `fakes()` function with:

```ts
function fakes() {
  const lines: string[] = [];
  const names: [string, string][] = [];
  const log: string[] = [];
  const checks: CheckRequest[] = [];
  let checkResult: CheckResult = { ok: true, tail: "" };
  let watch: ((e: WatchEvent) => void) | undefined;
  let exit: (() => void) | undefined;
  let saved: ScheduleFile | undefined;
  const ports: RunnerPorts = {
    launch: async (line) => (lines.push(line), { terminalId: 3, processId: 30 }),
    onExit: (_id, l) => ((exit = l), () => (exit = undefined)),
    watchClaude: (_req, l) => ((watch = l), { stop: () => (watch = undefined), arm: () => void log.push("arm") }),
    watchOpencode: () => ({ stop: () => {}, arm: () => {} }),
    rename: async (id, name) => void names.push([id, name]),
    newSessionId: () => "u-1",
    now: () => 1,
    save: async (f) => void (saved = structuredClone(f)),
    publish: () => {},
    paste: async (terminalId, text) => void log.push(`paste:${terminalId}:${text}`),
    check: async (req, stillWanted) => {
      if (!stillWanted()) return undefined;
      checks.push(req);
      return checkResult;
    },
  };
  return {
    ports,
    lines,
    names,
    log,
    checks,
    setCheck: (r: CheckResult) => void (checkResult = r),
    emit: (e: WatchEvent) => watch!(e),
    exit: () => exit!(),
    saved: () => saved,
    watching: () => !!watch,
  };
}
```

(This keeps the Task 16 handle shape and adds the two new ports; every existing test goes on using `fakes()` unchanged.) Then append inside `describe("ScheduleRunner", …)`:

```ts
  const looping: Schedule = {
    ...schedule,
    tasks: [
      {
        ...schedule.tasks[0]!,
        loop: { stopCriteria: "tests pass", followUp: "Keep going.", maxIterations: 3, check: "pnpm test", checkTimeoutSec: 30 },
      },
    ],
  };
  const start = async (f: ReturnType<typeof fakes>): Promise<ScheduleRunner> => {
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [looping], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    f.emit({ type: "session-found", sessionId: "u-1" });
    await settle();
    return runner;
  };

  it("re-arms the watcher before pasting the follow-up, and renames the session each iteration", async () => {
    const f = fakes();
    await start(f);
    f.emit({ type: "turn-ended", reply: "not yet" });
    await settle();
    expect(f.log).toEqual(["arm", `paste:3:${followUpPrompt(looping.tasks[0]!)}`]);
    expect(f.names).toEqual([
      ["u-1", "S · A (1/3)"],
      ["u-1", "S · A (2/3)"],
    ]);
    expect(f.saved()!.runs["s"]!.tasks["a"]).toMatchObject({ status: "running", iteration: 2 });
  });

  it("runs the check in the workspace once the reply ends with the marker; a pass converges", async () => {
    const f = fakes();
    await start(f);
    f.emit({ type: "turn-ended", reply: "done\nCONVERGED" });
    await settle();
    expect(f.checks).toEqual([{ command: "pnpm test", cwd: "/repo", timeoutMs: 30_000 }]);
    expect(f.saved()!.runs["s"]!.status).toBe("finished");
    expect(f.log).toEqual([]); // nothing pasted
  });

  it("a failed check pastes the follow-up with the check's output", async () => {
    const f = fakes();
    f.setCheck({ ok: false, tail: "FAIL a.test.ts" });
    await start(f);
    f.emit({ type: "turn-ended", reply: "done\nCONVERGED" });
    await settle();
    expect(f.log).toEqual([
      "arm",
      `paste:3:${followUpPrompt(looping.tasks[0]!, { command: "pnpm test", tail: "FAIL a.test.ts" })}`,
    ]);
  });

  it("does not run a queued check once its run was aborted (R9)", async () => {
    const f = fakes();
    let release: () => void = () => {};
    const wanted: boolean[] = [];
    f.ports.check = (_req, stillWanted) =>
      new Promise((resolve) => {
        release = () => {
          wanted.push(stillWanted());
          resolve(undefined);
        };
      });
    const runner = await start(f);
    f.emit({ type: "turn-ended", reply: "done\nCONVERGED" });
    await settle();
    await runner.abort("s");
    release();
    await settle();
    expect(wanted).toEqual([false]);
    expect(f.saved()!.runs["s"]!.status).toBe("aborted");
  });

  it("pause holds a turn end and resume replays it", async () => {
    const f = fakes();
    const runner = await start(f);
    await runner.pause("s");
    f.emit({ type: "turn-ended", reply: "not yet" });
    await settle();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("held");
    expect(f.log).toEqual([]);
    await runner.resume("s");
    await settle();
    expect(f.log).toEqual(["arm", `paste:3:${followUpPrompt(looping.tasks[0]!)}`]);
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-runner.test.ts`
Expected: FAIL. `runner.pause is not a function`, and the paste and check effects are not performed (`f.log` and `f.checks` stay `[]`).

- [ ] **Step 3: Protocol**

In `schedule-protocol.ts`, add to `SpexrScheduleService` after `abort`:

```ts
  /** Operator pause: no new task starts, and turn ends wait (held) until resume. */
  pause(scheduleId: string): Promise<void>;
  /** Undo pause: held turn ends are judged now, in schedule order. */
  resume(scheduleId: string): Promise<void>;
```

- [ ] **Step 4: Runner**

In `schedule-runner.ts`:

1. Add the import `import type { CheckRequest, CheckResult } from "./check-runner.js";`.
2. In `RunnerPorts`, after `publish(…)`, add:

```ts
  /** Bracketed paste, then Enter, into a task's pty. */
  paste(terminalId: number, text: string): Promise<void>;
  /** Queued backend-wide; resolves undefined when `stillWanted` said no once the check's turn came. */
  check(req: CheckRequest, stillWanted: () => boolean): Promise<CheckResult | undefined>;
```

3. After `private readonly releases = …;`, add:

```ts
  /** Each active task's watch, so a paste can re-arm it. Dropped with the task's other registrations. */
  private readonly watches = new Map<string, TaskWatch>();
```

4. After `abort(…)`, add:

```ts
  /** Operator pause: no new task starts and turn ends are held until resume(). */
  pause(scheduleId: string): Promise<void> {
    return this.dispatch(scheduleId, { type: "pause" });
  }

  /** Undo pause(): held turn ends are replayed in schedule order. */
  resume(scheduleId: string): Promise<void> {
    return this.dispatch(scheduleId, { type: "resume" });
  }
```

5. In `release(…)`, after `this.releases.delete(key);`, add `this.watches.delete(key);`.
6. In `perform(…)`, right after the `if (e.type === "name") { … }` block, add:

```ts
    if (e.type === "paste") {
      // Re-armed first: the reply to this paste counts even if it lands between
      // two reads, and the reply still on screen never counts twice (R1).
      this.watches.get(`${scheduleId}/${e.task}`)?.arm();
      await this.ports.paste(e.terminalId, e.text).catch((err) => console.error("[schedule] pasting the follow-up failed", err));
      return;
    }
    if (e.type === "check") {
      await this.check(scheduleId, runId, e);
      return;
    }
```

7. In `perform(…)`, replace `const registered: (() => void)[] = [];` with:

```ts
    const registered: (() => void)[] = [];
    let watch: TaskWatch;
```

replace `const watch =` with `watch =`, and replace `this.registerReleases(scheduleId, task.id, registered);` with:

```ts
    this.registerReleases(scheduleId, task.id, registered);
    this.watches.set(`${scheduleId}/${task.id}`, watch);
```

8. Add this method after `perform`:

```ts
  /**
   * Queue the task's check. When its turn comes it runs only if the same run
   * is still going and the task still waits on it (R9); its result goes back
   * bound to that run. A check that throws counts as failed, with the reason
   * as its output.
   */
  private async check(scheduleId: string, runId: string, e: Extract<Effect, { type: "check" }>): Promise<void> {
    const stillWanted = (): boolean => {
      const run = this.file.runs[scheduleId];
      return run?.runId === runId && run.status === "running" && run.tasks[e.task]?.status === "checking";
    };
    let result: CheckResult | undefined;
    try {
      result = await this.ports.check({ command: e.command, cwd: e.cwd, timeoutMs: e.timeoutSec * 1000 }, stillWanted);
    } catch (err) {
      result = { ok: false, tail: `The check could not run: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (!result) return;
    await this.dispatch(scheduleId, { type: "check-done", task: e.task, ok: result.ok, tail: result.tail }, runId);
  }
```

- [ ] **Step 5: Service**

In `spexr-schedule-backend-service.ts`:
- Add `import { CheckQueue, runCheck } from "./check-runner.js";`.
- After `private runner!: Promise<ScheduleRunner>;`, add:

```ts
  /** One queue for the whole backend (the service is a singleton): checks never overlap. */
  private readonly checks = new CheckQueue((req) => runCheck(req));
```

- After `abort(…)`, add:

```ts
  async pause(scheduleId: string): Promise<void> {
    await (await this.runner).pause(scheduleId);
  }

  async resume(scheduleId: string): Promise<void> {
    await (await this.runner).resume(scheduleId);
  }
```

- In `ports()`, after `publish: …`, add:

```ts
      paste: (id, text) => this.pty.paste(id, text),
      check: (req, stillWanted) => this.checks.run(req, stillWanted),
```

- [ ] **Step 6: Run to see them pass**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/`
Expected: PASS.

- [ ] **Step 7: Lint, typecheck, commit**

Run: `pnpm run lint && pnpm run typecheck`
Expected: clean. The frontend proxy picks up `pause`/`resume` through the interface; Task 20 wires the buttons.

```bash
git add src/common/schedule/schedule-protocol.ts src/node/schedule/schedule-runner.ts src/node/schedule/schedule-runner.test.ts src/node/schedule/spexr-schedule-backend-service.ts
git commit -m "feat(schedule): runner pastes follow-ups, queues checks, pauses and resumes runs"
```

### Task 20: Sidebar — loop settings and Pause / Resume

**Files:**
- Create: `src/browser/darkfactory/schedule/loop-edit.ts`
- Test: `src/browser/darkfactory/schedule/loop-edit.test.ts`
- Modify: `src/browser/darkfactory/schedule/schedule-view.ts`, test `schedule-view.test.ts`
- Modify: `src/browser/darkfactory/schedule/schedule-sidebar.tsx`
- Modify: `src/browser/darkfactory/darkfactory-wall-widget.tsx`
- Modify: `src/browser/style/spexr.css`

**Interfaces:**
- Consumes: `TaskLoop`, `DEFAULT_CHECK_TIMEOUT_SEC`, `MAX_CHECK_TIMEOUT_SEC`, `MAX_ITERATIONS` (Tasks 1, 17); `SpexrScheduleService.pause/resume` (Task 19).
- Produces:

```ts
// loop-edit.ts
export const DEFAULT_LOOP: TaskLoop;
export function withLoop(task: ScheduleTask, on: boolean): ScheduleTask;
export function patchLoop(task: ScheduleTask, patch: Partial<Pick<TaskLoop, "stopCriteria" | "followUp" | "maxIterations">>): ScheduleTask;
export function withCheck(task: ScheduleTask, command: string): ScheduleTask;
export function withCheckTimeout(task: ScheduleTask, input: string): ScheduleTask;
// schedule-view.ts — runBar() gains
canPause: boolean; canResume: boolean;
// ScheduleSidebarProps gains
onPause(scheduleId: string): void; onResume(scheduleId: string): void;
```

Write this task against `schedule-sidebar.tsx` as of commit `538e17a`, where `runProblems` carries a `scheduleId`. Use the targeted insertions below and never replace the whole file.

- [ ] **Step 1: Failing tests**

```ts
// src/browser/darkfactory/schedule/loop-edit.test.ts
import { describe, expect, it } from "vitest";
import type { ScheduleTask } from "../../../common/schedule/schedule-types.js";
import { DEFAULT_LOOP, patchLoop, withCheck, withCheckTimeout, withLoop } from "./loop-edit.js";

const t: ScheduleTask = { id: "a", name: "A", needs: [], project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p" };

describe("loop editing", () => {
  it("switches the loop on with defaults, keeps it when already on, and drops every loop setting when off", () => {
    const on = withLoop(t, true);
    expect(on.loop).toEqual(DEFAULT_LOOP);
    expect(withLoop(on, true)).toBe(on);
    expect(withLoop(on, false)).toEqual(t);
    expect("loop" in withLoop(on, false)).toBe(false);
  });
  it("patches loop fields, and ignores a task that does not loop", () => {
    expect(patchLoop(withLoop(t, true), { maxIterations: 9 }).loop!.maxIterations).toBe(9);
    expect(patchLoop(t, { maxIterations: 9 })).toBe(t);
  });
  it("a blank check command removes the check and its timeout", () => {
    const checked = withCheckTimeout(withCheck(withLoop(t, true), "pnpm test"), "120");
    expect(checked.loop).toMatchObject({ check: "pnpm test", checkTimeoutSec: 120 });
    const cleared = withCheck(checked, "  ");
    expect("check" in cleared.loop!).toBe(false);
    expect("checkTimeoutSec" in cleared.loop!).toBe(false);
  });
  it("an empty timeout returns to the default", () => {
    const checked = withCheckTimeout(withCheck(withLoop(t, true), "pnpm test"), "120");
    expect("checkTimeoutSec" in withCheckTimeout(checked, "").loop!).toBe(false);
  });
});
```

Append to `schedule-view.test.ts`, inside `describe("runBar", …)`:

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/schedule/`
Expected: FAIL. `Cannot find module './loop-edit.js'`, and `canPause` is undefined.

- [ ] **Step 3: Implement the view model**

```ts
// src/browser/darkfactory/schedule/loop-edit.ts
import type { ScheduleTask, TaskLoop } from "../../../common/schedule/schedule-types.js";

/** What "Loop until converged" starts from; the stop criteria are the operator's to write. */
export const DEFAULT_LOOP: TaskLoop = {
  stopCriteria: "",
  followUp: "Continue: work on the stop criteria that are not met yet.",
  maxIterations: 5,
};

/** Switch the loop on (with defaults, or as it is) or off (dropping every loop setting). */
export function withLoop(task: ScheduleTask, on: boolean): ScheduleTask {
  if (on) return task.loop ? task : { ...task, loop: { ...DEFAULT_LOOP } };
  const { loop: _dropped, ...rest } = task;
  return rest;
}

/** Change loop texts or the iteration limit; a task that does not loop is returned as is. */
export function patchLoop(
  task: ScheduleTask,
  patch: Partial<Pick<TaskLoop, "stopCriteria" | "followUp" | "maxIterations">>,
): ScheduleTask {
  return task.loop ? { ...task, loop: { ...task.loop, ...patch } } : task;
}

/** Set the check command; a blank one removes the check and its timeout. */
export function withCheck(task: ScheduleTask, command: string): ScheduleTask {
  if (!task.loop) return task;
  if (command.trim()) return { ...task, loop: { ...task.loop, check: command } };
  const { check: _check, checkTimeoutSec: _timeout, ...loop } = task.loop;
  return { ...task, loop };
}

/** Set the check timeout from a number input; empty input returns to the default. Range is validation's job. */
export function withCheckTimeout(task: ScheduleTask, input: string): ScheduleTask {
  if (!task.loop) return task;
  const sec = Number(input);
  if (!input.trim() || !Number.isFinite(sec)) {
    const { checkTimeoutSec: _timeout, ...loop } = task.loop;
    return { ...task, loop };
  }
  return { ...task, loop: { ...task.loop, checkTimeoutSec: sec } };
}
```

In `schedule-view.ts`, replace the whole `runBar` function with:

```ts
/** What the run bar offers, and why Run is unavailable when it is. */
export function runBar(
  schedule: Schedule,
  run: RunState | undefined,
  problems: ValidationProblem[],
): { canRun: boolean; canAbort: boolean; canPause: boolean; canResume: boolean; label: string; reasons: string[] } {
  const names = new Map(schedule.tasks.map((t) => [t.id, t.name]));
  const reasons = problems.map((p) => (p.task ? `${names.get(p.task) ?? p.task}: ${p.message}` : p.message));
  const running = run?.status === "running";
  const operatorPaused = running && run?.pausedBy === "operator";
  const label = !run
    ? "Not run yet"
    : running
      ? operatorPaused
        ? "Paused"
        : run.pausedBy === "failure"
          ? "Paused on a failure"
          : "Running"
      : run.status === "finished"
        ? "Finished"
        : "Aborted";
  return {
    canRun: !running && reasons.length === 0,
    canAbort: running,
    canPause: running && !operatorPaused,
    canResume: operatorPaused,
    label,
    reasons,
  };
}
```

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/schedule/`
Expected: PASS.

- [ ] **Step 4: Sidebar**

In `schedule-sidebar.tsx`:

1. Change the types import to

```ts
import {
  DEFAULT_CHECK_TIMEOUT_SEC,
  MAX_CHECK_TIMEOUT_SEC,
  MAX_ITERATIONS,
  PERMISSION_MODES,
  type Schedule,
  type ScheduleTask,
  type ValidationProblem,
} from "../../../common/schedule/schedule-types.js";
```

and add `import { patchLoop, withCheck, withCheckTimeout, withLoop } from "./loop-edit.js";`.

2. In `ScheduleSidebarProps`, after `onAbort(scheduleId: string): void;`, add:

```ts
  /** No new task starts and no follow-up is pasted until onResume. */
  onPause(scheduleId: string): void;
  onResume(scheduleId: string): void;
```

3. In the run bar, right after `<span className="sl-tag">{bar!.label}</span>`, insert:

```tsx
            {bar!.canPause && (
              <button
                className="sl-btn sl-btn--sm"
                onClick={() => p.onPause(schedule.id)}
                title="No new task starts and no follow-up is pasted until you resume"
              >
                <i className="codicon codicon-debug-pause" aria-hidden="true" /> Pause
              </button>
            )}
            {bar!.canResume && (
              <button className="sl-btn sl-btn--sm" onClick={() => p.onResume(schedule.id)}>
                <i className="codicon codicon-debug-continue" aria-hidden="true" /> Resume
              </button>
            )}
```

(Both are secondary: Run stays the only primary button.)

4. In `TaskEditor`, between the `{field("Prompt", …)}` call and `<details className="spexr-sched__advanced">`, insert:

```tsx
      <label className="sl-switch spexr-sched__loop-switch">
        <input
          type="checkbox"
          role="switch"
          className="sl-switch__input"
          checked={!!t.loop}
          onChange={(e) => p.onChange(withLoop(t, e.target.checked))}
        />
        <span className="sl-switch__track" aria-hidden="true" />
        <span className="sl-switch__label">Loop until converged</span>
      </label>
      {t.loop && (
        <fieldset className="spexr-sched__loop">
          <legend className="spexr-sched__sr">Loop settings</legend>
          {field(
            "Stop criteria",
            "loop.stopCriteria",
            <textarea
              className="sl-field__input"
              rows={3}
              value={t.loop.stopCriteria}
              placeholder="All tests pass and the linter is clean."
              onChange={(e) => p.onChange(patchLoop(t, { stopCriteria: e.target.value }))}
            />,
          )}
          {field(
            "Follow-up, pasted on every new iteration",
            "loop.followUp",
            <textarea
              className="sl-field__input"
              rows={3}
              value={t.loop.followUp}
              onChange={(e) => p.onChange(patchLoop(t, { followUp: e.target.value }))}
            />,
          )}
          {field(
            "Max iterations",
            "loop.maxIterations",
            <input
              className="sl-field__input"
              type="number"
              min={1}
              max={MAX_ITERATIONS}
              value={t.loop.maxIterations}
              onChange={(e) => p.onChange(patchLoop(t, { maxIterations: Number(e.target.value) }))}
            />,
          )}
          {field(
            "Check command (optional)",
            "loop.check",
            <input
              className="sl-field__input spexr-sched__mono"
              value={t.loop.check ?? ""}
              placeholder="pnpm test"
              onChange={(e) => p.onChange(withCheck(t, e.target.value))}
            />,
          )}
          <p className="spexr-sched__hint">
            Runs in the task's folder after a reply that ends with CONVERGED, one check at a time across all runs. If
            it fails, its last 40 lines go into the next follow-up. It runs in a login shell without your .zshrc:
            give full paths, or start with `source ~/.zshrc &&`. Placeholders are not filled in here.
          </p>
          {t.loop.check !== undefined &&
            field(
              "Check timeout (seconds)",
              "loop.checkTimeoutSec",
              <input
                className="sl-field__input"
                type="number"
                min={1}
                max={MAX_CHECK_TIMEOUT_SEC}
                value={t.loop.checkTimeoutSec ?? ""}
                placeholder={String(DEFAULT_CHECK_TIMEOUT_SEC)}
                onChange={(e) => p.onChange(withCheckTimeout(t, e.target.value))}
              />,
            )}
          {t.harness === "opencode" && (
            <p className="spexr-sched__hint">
              opencode turn ends are read from the wall's scan, so each iteration can start up to about 20 seconds late.
            </p>
          )}
        </fieldset>
      )}
```

- [ ] **Step 5: Wire the wall widget**

In `darkfactory-wall-widget.tsx`, after the `onAbort={…}` prop of `<ScheduleSidebar`, add:

```tsx
              onPause={(id) => void this.schedules.pause(id).catch(() => undefined)}
              onResume={(id) => void this.schedules.resume(id).catch(() => undefined)}
```

- [ ] **Step 6: Styles**

In `src/browser/style/spexr.css`, after the `.spexr-sched__sr` rule, add:

```css
/* The loop settings unfold under their switch, stepped in so they read as belonging to it. */
.spexr-sched__loop {
  display: flex; flex-direction: column; gap: var(--sl-space-3);
  margin: 0; padding: 0 0 0 var(--sl-space-3);
  border: 0; border-left: 2px solid var(--sl-border-subtle);
  animation: spexr-sched-unfold var(--sl-motion-fast, 120ms) var(--sl-motion-ease);
}
@keyframes spexr-sched-unfold { from { opacity: 0; transform: translateY(calc(var(--sl-space-1) * -1)); } }
.spexr-sched__hint { margin: 0; font-size: var(--sl-text-xs); color: var(--sl-text-muted); }
.spexr-sched__mono { font-family: var(--sl-font-mono); }
```

and extend the existing reduced-motion rule to
`@media (prefers-reduced-motion: reduce) { .spexr-sched__rowmain { transition: none; } .spexr-sched__loop { animation: none; } }`.
Every token above is already used by the Task 13 rules; `--sl-space-1` is used elsewhere in `spexr.css`.

- [ ] **Step 7: Verify**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/ src/common/schedule/ src/node/schedule/ && pnpm run lint && pnpm run typecheck`
Expected: PASS.

- [ ] **Step 8: Manual check in the app (AC-9, AC-10, AC-11)**

Rebuild, and quit any running SPEXR first (`docs/memory/electron-single-instance-lock.md`). Then:
1. **One Claude task in a scratch repo.** Set the prompt to "Create notes.md with one line.", switch on "Loop until converged", set the stop criteria to "notes.md has at least three lines", max iterations 4, check command `test $(wc -l < notes.md) -ge 3`, and permission mode `acceptEdits`. Run it. The row goes through Working → Checking → Working (2 / 4) and ends Converged. The card shows each follow-up arriving as **one** prompt; when a check failed, the follow-up quotes its output. The card's name shows `(n/4)` for the current iteration.
2. **Max iterations.** Same task with max iterations 1 and stop criteria that cannot be met ("the file has 100 lines"). The row shows Failed with "Not converged after 1 iteration", and the run shows "Paused on a failure".
3. **Pause and Resume.** Press Pause while a looping task is working. When its turn ends, the row shows Held and nothing is pasted. Press Resume: the follow-up is pasted, and the run bar goes back to Running.
4. **Timeout.** Set the check to `sleep 30` with a timeout of 5. The follow-up says the check timed out, and no `sleep` is left running (`pgrep -f 'sleep 30'` is empty).
5. **opencode.** One looping opencode task converges over two iterations (each tens of seconds late).
6. **Both themes, and keyboard only.** Tab reaches the loop switch and every loop field with a visible focus ring; the fieldset unfolds; Held and Checking are announced.
7. **A real check.** In a repo whose `pnpm` comes from nvm, a task with check `pnpm test` gets past "command not found". If it does not, the login shell is missing the PATH (R10): record that on the PR and change the sidebar hint to require full paths.

- [ ] **Step 9: Commit**

```bash
git add src/browser/darkfactory/schedule/ src/browser/darkfactory/darkfactory-wall-widget.tsx src/browser/style/spexr.css
git commit -m "feat(schedule): loop settings and Pause/Resume in the plant-schedule sidebar (AC-9..AC-11)"
```

**Slice 3 ends here.** Push to https://github.com/sondalab-ai/spexr-ide/pull/66 and tick the slice.

---

# Slice 4 — The graph

Planned in full on 2026-09-28 against the code after Task 20 (commit `66545b6`). Where this plan and the Slice 1–3 task text disagree, the code wins. Where the code disagrees with the spec, the task below fixes the code. The contradictions found:

- **A `sameAs` task can land in the project folder.** `ScheduleRunner.perform` resolves a `sameAs` workspace as `run.tasks[up]?.workspace ?? task.project`. If the upstream is a worktree task that never started (it was skipped after its worktree failed), the dependent runs in the project folder. That goes around the shared-folder guard. Fixed in Task 26 (R20).
- **A skipped task leaks its reply.** `advance()` fills `{{x.reply}}` from the stored reply whatever the task's status. A task that failed after replying still has one, so skipping it would carry that reply into its dependents. AC-14 says it renders empty. Fixed in Task 22.
- **New effects can be dropped without a trace.** `perform()` ends with `if (e.type !== "start") return;`, so any new effect type is ignored silently. This was a deferred minor from Task 19. Task 25 replaces it with an exhaustive switch.
- **The sidebar is missing parts of the spec.** It has no Duplicate button (spec, Sidebar). Rows show neither the workspace nor the adopted opencode session id (spec, Risks). `aria-current` follows the task being edited, not the selected one. Deleting a schedule asks for no confirmation. Fixed in Tasks 29 and 31.

**Rulings for this slice** (numbering continues from Slice 3)

- **R11. Retry starts the task at once, even while the run is paused.** Resetting it to `pending` and letting `advance()` start it would deadlock when two tasks have failed: the failure pause stays set, so nothing starts. Under an operator pause the retried task starts, and R4 holds its turn end like any other. *Cost if wrong:* an operator who paused and then retries sees one session start during the pause.
- **R12. Retry resets the task to a bare `{ status: "starting", iteration: 1 }`.** The terminal, process, session, workspace, reply, error and check output are all dropped. `starting` is an active status, so a leftover `terminalId` would make `taskCardsToMount` re-attach the old terminal. *Cost if wrong:* the failed attempt's last reply is gone from the run state. Its transcript stays on disk.
- **R13. Retry closes the failed attempt's session; Skip and Abort do not.**
  - Retry closes the session if it is still open. The new session works in the same folder, and the shared-folder guard exists to keep one live session per folder.
  - Every close is checked against the recorded process id.
  - An `interrupted` task's terminal is never closed. Its id died with the old backend and may now belong to someone else's shell.
  - Skip leaves the failed session open for the operator to read. Abort leaves every session open (spec).
  - *Cost if wrong:* Retry loses the failed TUI, although the wall still lists the session as resumable. After a Skip, a `sameAs` dependent shares its folder with the skipped session's TUI until the operator closes it, and the wall may credit liveness to either one.
- **R14. A pty that nothing can see is closed.** This covers three cases:
  - a launch that resolves after its run was aborted or replaced;
  - a `started` event dropped by `dispatch()` for a stale or finished run;
  - a launch whose watcher or exit listener could not be registered.
  
  Such a pty has no card and no watcher. This settles the Task 11 deferred minor. *Cost if wrong:* none known. Only ptys whose terminal id was never recorded in any run are closed.
- **R15. A new Run refuses a leftover worktree or branch; Retry reuses it.** AC-13 asks for a *fresh* worktree. So a first start finds `spexr/<schedule>/<task>` or its folder left from an earlier run, and fails the task with the commands that remove them. Retry continues on whatever is there: the worktree itself, or a new worktree for a branch left without one. *Cost if wrong:* every rerun after a finished or aborted run stops at each worktree task, until the operator cleans up or presses Retry.
- **R16. The task keeps its place inside the repository.** When the project is a folder inside its repository (a package in a monorepo), the task works in the same folder inside the worktree (`rev-parse --show-prefix`). A folder git does not track has no copy there, so the start fails. *Cost if wrong:* none for projects at the repository root.
- **R17. Git runs through `execFile` only, one worktree change at a time per repository.**
  - The per-repository key is `--git-common-dir`. This needs git ≥ 2.31 for `--path-format=absolute`; this machine has 2.50.
  - Every call has a 30-second timeout.
  - *Cost if wrong:* the second of two siblings waits about 0.1 s for the first one's worktree.
- **R18. The trust dialog stays with the operator.**
  - Every new worktree is a folder Claude has not seen, so Claude shows its folder-trust dialog once. The task shows *Needs you* after 8 s (Task 8).
  - The schedule never edits Claude's own settings (`.claude.json`) to skip the dialog. Other Claude processes rewrite that file whole, and its format is not a public contract.
  - The editor tells the operator to choose "Yes" in the card. The dialog's default answer, "No, exit", ends the pty, and the task fails.
  - *Cost if wrong:* a schedule with Claude worktree tasks is not unattended. Each new worktree waits for one answer.
- **R19. Worktree folder names may collide, and no check prevents it.** Ids may contain dashes, so schedule `a-b` with task `c` and schedule `a` with task `b-c` map to the same sibling folder. The second one then finds the folder taken and fails with a message that says so. *Cost if wrong:* the operator renames one task or schedule.
- **R20. A `sameAs` task resolves its folder at start, never falling back to the project folder.** The resolution order:
  1. The folder the upstream recorded when it started.
  2. For a `folder` upstream that never started, its project.
  3. Through a `sameAs` chain, the same rules one link further up.
  4. When the chain ends at a worktree that was never made, the task fails to start with a reason.
  
  *Cost if wrong:* none. Falling back to the project folder would break the shared-folder guard.
- **R21. Retry and Skip apply only to a `failed` or `interrupted` task of a running run.** Anything else is answered with a problem, and the sidebar shows it above Run. Retry also re-checks the launch command, exactly as Run does. *Cost if wrong:* none.
- **R22. Retry resolves the task's launch again in the frontend.** The preferences or the active profile may have changed since Run. The new launch replaces `run.launches[task]`. *Cost if wrong:* none. It is the same resolution Run performs.
- **R23. The editor prevents a cycle before it can be saved.** A "waits for" choice that would close a cycle is shown disabled, with the reason next to it. Placeholders are inserted with one button per hand-off, not with a `<select>`: in Chromium, arrowing through a closed select fires `change` on every step, which would insert a token at each one. *Cost if wrong:* none.

### Task 21: Record the Slice 4 rulings in the spec

**Files:**
- Modify: `docs/specs/0018-plant-schedule.md` (Engine, Launch, Risks)

**Interfaces:** none (documentation). Every later task implements what this one states.

- [ ] **Step 1: Engine**

In `### Engine`, find the bullet that begins with "A task that fails pauses the run" and ends with "or aborts the run.". Insert this bullet directly after it:

```markdown
- Retry starts the task at once, even while the run is paused; an operator
  pause then holds its turn end like any other. Nothing of the failed attempt
  is carried over (terminal, session, reply, error), and its session is closed
  if it is still open, because the new session works in the same folder. An
  interrupted task's session is never closed: its terminal id died with the old
  backend and may now belong to another process. Skip leaves the failed session
  open for the operator to read. After either, the run stays paused on a
  failure only while another task is still failed or interrupted; an operator
  pause is kept. Both apply only to a failed or interrupted task.
```

- [ ] **Step 2: Launch**

In `### Launch`, replace the paragraph that begins "The workspace is prepared before launch:" with:

```markdown
The workspace is prepared before launch. A `worktree` task runs
`git worktree add -b spexr/<schedule>/<task> <path> HEAD` in the project's
repository (`git -C <project> rev-parse --show-toplevel`), with `<path>` a
sibling folder `<repo>-spexr-<schedule>-<task>`, so it starts from the
project's last commit; uncommitted changes stay behind. When the project is a
folder inside its repository, the task works in the same folder inside the
worktree. Git runs with an argument list, never through a shell, one worktree
change at a time per repository. A retry reuses the task's worktree, or makes
one for its branch when only the branch is left. A new run refuses a worktree
or branch left from an earlier run and names the commands that remove them;
Retry continues on them instead. A `sameAs` task runs in the folder its
upstream actually used; when the upstream never got one (a worktree task
skipped before it started), the task fails to start rather than fall back to
the project folder.

A pty that starts for a run that has meanwhile been aborted or replaced, or
whose watcher cannot be registered, is closed: it has no card and nothing
watches it.
```

- [ ] **Step 3: Risks**

In `## Risks`, in the probe bullet that ends "Every new worktree (Slice 4) is a new folder and will ask once.", append:

```markdown
    The operator answers it in the task's card: choose "Yes" (the default
    answer ends the session and fails the task). The schedule never edits
    Claude's own settings to skip the dialog; a schedule with Claude worktree
    tasks is therefore not unattended.
```

- [ ] **Step 4: Commit**

```bash
git add docs/specs/0018-plant-schedule.md
git commit -m "docs(spec): 0018 retry, skip, worktree reuse and the trust dialog (Slice 4 rulings)"
```

### Task 22: Engine — retry and skip

**Files:**
- Modify: `src/common/schedule/schedule-types.ts`
- Modify: `src/node/schedule/schedule-engine.ts`
- Test: `src/node/schedule/schedule-engine.test.ts`

**Interfaces:**
- Consumes: `TaskLaunch`, `SETTLED_STATUSES` (Task 1); `fail`, `hasFailure`, `advance` (Tasks 10, 18).
- Produces:

```ts
// schedule-types.ts
export const RETRYABLE_STATUSES: ReadonlySet<TaskStatus>; // failed, interrupted
// schedule-engine.ts
export type EngineEvent = /* … */ | { type: "retry"; task: string; launch: TaskLaunch } | { type: "skip"; task: string };
export type Effect =
  | { type: "start"; task: string; prompt: string; reuse?: true } // reuse: set only by a retry (R15)
  | /* name, paste, check as before */
  | { type: "close"; terminalId: number; processId: number };    // R13
```

- [ ] **Step 1: Failing tests**

Append to `schedule-engine.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-engine.test.ts`
Expected: FAIL. TypeScript accepts no `retry` event, and at run time the retried task stays `failed`.

- [ ] **Step 3: Implement**

In `schedule-types.ts`, after `SETTLED_STATUSES`:

```ts
/** Retry and Skip apply to a task in one of these (spec, Engine; R21). */
export const RETRYABLE_STATUSES: ReadonlySet<TaskStatus> = new Set(["failed", "interrupted"]);
```

In `schedule-engine.ts`:

1. Add `RETRYABLE_STATUSES` to the import from `schedule-types.js`.
2. Add to `EngineEvent`, after `| { type: "recover" }`:

```ts
  | { type: "retry"; task: string; launch: TaskLaunch }
  | { type: "skip"; task: string };
```

(and drop the `;` after `{ type: "recover" }`).

3. Replace the `Effect` type with:

```ts
export type Effect =
  | { type: "start"; task: string; prompt: string; reuse?: true }
  | { type: "name"; sessionId: string; name: string }
  | { type: "paste"; task: string; terminalId: number; text: string }
  | { type: "check"; task: string; command: string; cwd: string; timeoutSec: number }
  | { type: "close"; terminalId: number; processId: number };
```

4. In `step`, before `case "abort":`, insert:

```ts
    case "retry":
      if (!task || !RETRYABLE_STATUSES.has(task.status)) break;
      // R13: the failed attempt's session may still be open in the folder the
      // retry works in. An interrupted one's terminal died with the old backend.
      if (task.status === "failed" && task.terminalId !== undefined && task.processId !== undefined) {
        effects.push({ type: "close", terminalId: task.terminalId, processId: task.processId });
      }
      run.launches[event.task] = event.launch;
      // R11: started here, not left pending, so another task's failure pause cannot hold it back.
      startTask(schedule, run, taskOf(schedule, event.task), effects, true);
      recomputeFailurePause(run);
      break;
    case "skip":
      if (!task || !RETRYABLE_STATUSES.has(task.status)) break;
      task.status = "skipped";
      recomputeFailurePause(run);
      break;
```

5. After `hasFailure`, add:

```ts
/** R3 for retry and skip: an operator pause stays; otherwise the run pauses only while a task is still failed or interrupted. */
function recomputeFailurePause(run: RunState): void {
  if (run.pausedBy === "operator") return;
  if (hasFailure(run)) run.pausedBy = "failure";
  else delete run.pausedBy;
}

/** Start one task from a bare state at iteration 1 (R12), its hand-offs filled from upstream. */
function startTask(schedule: Schedule, run: RunState, t: ScheduleTask, effects: Effect[], reuse: boolean): void {
  run.tasks[t.id] = { status: "starting", iteration: 1 };
  const filled = fillPlaceholders(t.prompt, (id, field) => handOff(run, id, field));
  effects.push({ type: "start", task: t.id, prompt: firstPrompt(t, filled), ...(reuse ? { reuse: true as const } : {}) });
}

/** What a placeholder receives: nothing from a skipped task (AC-14), else its reply without the marker, or its folder. */
function handOff(run: RunState, taskId: string, field: "reply" | "workspace"): string | undefined {
  const up = run.tasks[taskId];
  if (!up || up.status === "skipped") return undefined;
  return field === "reply" ? stripMarker(up.reply ?? "") : up.workspace;
}
```

6. In `advance`, replace the `for (const t of ready(schedule, run)) { … }` loop body with a call:

```ts
    for (const t of ready(schedule, run)) startTask(schedule, run, t, effects, false);
```

The runner ignores `close` until Task 25 and never raises `retry` or `skip` until Task 26, so nothing changes in the app yet.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/ src/common/schedule/`
Expected: PASS, and every Slice 2–3 engine test is unchanged: `reuse` is absent from ordinary starts.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `pnpm run lint && pnpm run typecheck`
Expected: clean.

```bash
git add src/common/schedule/schedule-types.ts src/node/schedule/schedule-engine.ts src/node/schedule/schedule-engine.test.ts
git commit -m "feat(schedule): engine retries and skips failed or interrupted tasks (AC-14, AC-15)"
```

### Task 23: Engine — the graph end to end, and where a task works

**Files:**
- Modify: `src/node/schedule/schedule-engine.ts`
- Test: `src/node/schedule/schedule-engine.test.ts`

**Interfaces:**
- Consumes: `startRun`, `step` (Tasks 10, 18, 22).
- Produces:

```ts
export type WorkspacePlan = { kind: "path"; path: string } | { kind: "worktree" } | { kind: "missing"; reason: string };
export function workspacePlan(schedule: Schedule, run: RunState, taskId: string): WorkspacePlan; // R20
```

- [ ] **Step 1: Failing tests**

Add `workspacePlan` to the import from `./schedule-engine.js` and append:

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-engine.test.ts`
Expected: FAIL: `workspacePlan` is not a function (under Vitest's transform the missing export is `undefined`), and typecheck reports the missing export. The two graph tests pass already, because they pin the behaviour Tasks 10, 18 and 22 built.

- [ ] **Step 3: Implement**

Append to `schedule-engine.ts`:

```ts
export type WorkspacePlan = { kind: "path"; path: string } | { kind: "worktree" } | { kind: "missing"; reason: string };

/**
 * Where a task runs, from the schedule and what its run recorded: its project,
 * a worktree to prepare, or — for `sameAs` — the folder its upstream actually
 * used (R20). A worktree upstream that never got one is "missing", never the
 * project folder: that would put two sessions in one folder behind the
 * shared-folder guard's back.
 */
export function workspacePlan(schedule: Schedule, run: RunState, taskId: string): WorkspacePlan {
  const seen = new Set<string>();
  let id = taskId;
  for (;;) {
    const t = schedule.tasks.find((x) => x.id === id);
    if (!t) return { kind: "missing", reason: `Unknown task: ${id}.` };
    if (id !== taskId) {
      const recorded = run.tasks[id]?.workspace;
      if (recorded) return { kind: "path", path: recorded };
    }
    if (t.workspace.kind === "folder") return { kind: "path", path: t.project };
    if (t.workspace.kind === "worktree") {
      if (id === taskId) return { kind: "worktree" };
      return {
        kind: "missing",
        reason: `"${t.name}" never got its worktree, so there is no workspace to share. Retry it, or give this task its own workspace.`,
      };
    }
    if (seen.has(id)) return { kind: "missing", reason: "The shared workspaces point at each other." };
    seen.add(id);
    id = t.workspace.task;
  }
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-engine.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `pnpm run lint && pnpm run typecheck`
Expected: clean.

```bash
git add src/node/schedule/schedule-engine.ts src/node/schedule/schedule-engine.test.ts
git commit -m "feat(schedule): pin graph execution and resolve sameAs to the upstream's real folder (AC-12, AC-14, R20)"
```

### Task 24: Worktree workspaces

**Files:**
- Create: `src/node/schedule/workspace.ts`
- Test: `src/node/schedule/workspace.test.ts`

**Interfaces:**
- Produces:

```ts
export const GIT_TIMEOUT_MS = 30_000;
export interface WorktreeRequest { project: string; scheduleId: string; taskId: string; reuse: boolean }
export function worktreeBranch(scheduleId: string, taskId: string): string;       // spexr/<schedule>/<task>
export function worktreePath(toplevel: string, scheduleId: string, taskId: string): string; // <parent>/<repo>-spexr-<schedule>-<task>
export function parseWorktreeList(porcelain: string): { path: string; branch?: string }[];
export class Workspaces { prepareWorktree(req: WorktreeRequest): Promise<string> } // resolves the task's cwd
```

- [ ] **Step 1: Failing tests**

The repository is created in its own temporary parent folder. Its sibling worktrees land there as well, so two workers never collide, and one `rm` cleans everything up. User and system git config are switched off, so global hooks and gpg signing cannot hang the tests.

```ts
// src/node/schedule/workspace.test.ts
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Workspaces, parseWorktreeList, worktreeBranch, worktreePath } from "./workspace.js";

const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const g = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8" },
  ).trim();

function makeRepo(parent: string, name: string): string {
  const repo = join(parent, name);
  mkdirSync(join(repo, "packages", "web"), { recursive: true });
  writeFileSync(join(repo, "packages", "web", "index.ts"), "export {};\n");
  g(repo, "init", "-q", "--initial-branch=main");
  g(repo, "add", ".");
  g(repo, "commit", "-q", "-m", "init");
  return repo;
}

let parent: string;
let repo: string;
beforeEach(() => {
  parent = realpathSync(mkdtempSync(join(tmpdir(), "spexr-ws-"))); // macOS: /var → /private/var, as git reports it
  repo = makeRepo(parent, "app");
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));

const fresh = () => ({ project: repo, scheduleId: "s", taskId: "t", reuse: false });

describe("worktree naming", () => {
  it("puts the worktree next to the repository, on spexr/<schedule>/<task>", () => {
    expect(worktreeBranch("nightly", "api")).toBe("spexr/nightly/api");
    expect(worktreePath("/src/app", "nightly", "api")).toBe("/src/app-spexr-nightly-api");
  });
  it("reads git's porcelain worktree list", () => {
    expect(parseWorktreeList("worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r-x\nHEAD def\ndetached\n")).toEqual([
      { path: "/r", branch: "main" },
      { path: "/r-x" },
    ]);
  });
});

describe("Workspaces.prepareWorktree", () => {
  it("makes a fresh worktree on spexr/<schedule>/<task> from the project's HEAD, next to the repository (AC-13)", async () => {
    const ws = await new Workspaces().prepareWorktree({ project: repo, scheduleId: "nightly", taskId: "api", reuse: false });
    expect(ws).toBe(join(parent, "app-spexr-nightly-api"));
    expect(g(ws, "rev-parse", "--abbrev-ref", "HEAD")).toBe("spexr/nightly/api");
    expect(g(ws, "rev-parse", "HEAD")).toBe(g(repo, "rev-parse", "HEAD"));
    expect(g(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main"); // the project stays where it was
  });

  it("runs a project that is a folder inside its repository in the same folder of the worktree (R16)", async () => {
    const ws = await new Workspaces().prepareWorktree({ ...fresh(), project: join(repo, "packages", "web") });
    expect(ws).toBe(join(parent, "app-spexr-s-t", "packages", "web"));
    expect(existsSync(join(ws, "index.ts"))).toBe(true);
  });

  it("a retry continues in the same worktree, with the work left there (R15)", async () => {
    const w = new Workspaces();
    const first = await w.prepareWorktree(fresh());
    writeFileSync(join(first, "notes.md"), "half done\n");
    expect(await w.prepareWorktree({ ...fresh(), reuse: true })).toBe(first);
    expect(existsSync(join(first, "notes.md"))).toBe(true);
    expect(g(repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2);
  });

  it("a new run refuses a worktree left from an earlier run, and says how to clean up or continue (R15)", async () => {
    const w = new Workspaces();
    await w.prepareWorktree(fresh());
    await expect(w.prepareWorktree(fresh())).rejects.toThrow(/left from an earlier run.*Retry.*git worktree remove/s);
  });

  it("a retry makes a worktree for a branch left without one; a new run refuses the branch (R15)", async () => {
    const w = new Workspaces();
    const first = await w.prepareWorktree(fresh());
    g(repo, "worktree", "remove", first); // the branch stays
    await expect(w.prepareWorktree(fresh())).rejects.toThrow(/branch spexr\/s\/t is left from an earlier run.*git branch -D/s);
    expect(await w.prepareWorktree({ ...fresh(), reuse: true })).toBe(first);
    expect(g(first, "rev-parse", "--abbrev-ref", "HEAD")).toBe("spexr/s/t");
  });

  it("refuses a folder at the worktree path that is not this task's worktree, and leaves it alone (R19)", async () => {
    const taken = join(parent, "app-spexr-s-t");
    mkdirSync(taken);
    writeFileSync(join(taken, "keep.txt"), "mine");
    const w = new Workspaces();
    await expect(w.prepareWorktree(fresh())).rejects.toThrow(/already exists/);
    await expect(w.prepareWorktree({ ...fresh(), reuse: true })).rejects.toThrow(/already exists/);
    expect(existsSync(join(taken, "keep.txt"))).toBe(true);
  });

  it("refuses a branch checked out in another folder", async () => {
    g(repo, "worktree", "add", "-q", "-b", "spexr/s/t", join(parent, "elsewhere"));
    await expect(new Workspaces().prepareWorktree({ ...fresh(), reuse: true })).rejects.toThrow(/checked out in .*elsewhere/);
  });

  it("refuses a folder outside any git repository", async () => {
    const plain = join(parent, "plain");
    mkdirSync(plain);
    await expect(new Workspaces().prepareWorktree({ ...fresh(), project: plain })).rejects.toThrow(/not inside a git repository/);
  });

  it("starts from a linked worktree's own HEAD when the project is itself a worktree", async () => {
    const linked = join(parent, "app-feature");
    g(repo, "worktree", "add", "-q", "-b", "feature", linked);
    g(linked, "commit", "-q", "--allow-empty", "-m", "feature work");
    const ws = await new Workspaces().prepareWorktree({ ...fresh(), project: linked });
    expect(ws).toBe(join(parent, "app-feature-spexr-s-t"));
    expect(g(ws, "rev-parse", "HEAD")).toBe(g(linked, "rev-parse", "HEAD"));
  });

  it("two siblings prepared at once both get their worktree (R17)", async () => {
    const w = new Workspaces();
    const [a, b] = await Promise.all([
      w.prepareWorktree({ ...fresh(), taskId: "a" }),
      w.prepareWorktree({ ...fresh(), taskId: "b" }),
    ]);
    expect([a, b]).toEqual([join(parent, "app-spexr-s-a"), join(parent, "app-spexr-s-b")]);
  });

  it("never goes through a shell: a repository whose path is shell syntax works and runs nothing (Security)", async () => {
    const odd = makeRepo(parent, "it's $(touch PWNED) ;`touch PWNED2`");
    const ws = await new Workspaces().prepareWorktree({ ...fresh(), project: odd });
    expect(g(ws, "rev-parse", "--abbrev-ref", "HEAD")).toBe("spexr/s/t");
    for (const dir of [parent, odd, ws, process.cwd()]) {
      expect(existsSync(join(dir, "PWNED"))).toBe(false);
      expect(existsSync(join(dir, "PWNED2"))).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/workspace.test.ts`
Expected: FAIL. `Cannot find module './workspace.js'`.

- [ ] **Step 3: Implement**

```ts
// src/node/schedule/workspace.ts
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** A git call never waits longer than this: a hung git must not hold a task in Starting for ever. */
export const GIT_TIMEOUT_MS = 30_000;

export interface WorktreeRequest {
  /** The task's project folder: a repository root or a folder inside one. */
  project: string;
  scheduleId: string;
  taskId: string;
  /** A retry continues on a worktree or branch left from before; a first start refuses them (R15). */
  reuse: boolean;
}

interface Repo {
  toplevel: string;
  /** The project's folder relative to `toplevel`, "" at the root. */
  prefix: string;
  /** Shared by every worktree of the repository: the key worktree changes are serialized on (R17). */
  commonDir: string;
}

/** The branch a worktree task works on (spec, Launch). */
export function worktreeBranch(scheduleId: string, taskId: string): string {
  return `spexr/${scheduleId}/${taskId}`;
}

/** The worktree's folder: a sibling of the repository root, `<repo>-spexr-<schedule>-<task>`. */
export function worktreePath(toplevel: string, scheduleId: string, taskId: string): string {
  return join(dirname(toplevel), `${basename(toplevel)}-spexr-${scheduleId}-${taskId}`);
}

/** The entries of `git worktree list --porcelain`: each folder and, when one is checked out, its branch. */
export function parseWorktreeList(porcelain: string): { path: string; branch?: string }[] {
  const out: { path: string; branch?: string }[] = [];
  for (const block of porcelain.split(/\n\n+/)) {
    let path: string | undefined;
    let branch: string | undefined;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
    }
    if (path) out.push(branch ? { path, branch } : { path });
  }
  return out;
}

/** Run git with an argument list, never a shell: no path or id is ever read as shell syntax. */
function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr).trim() || err.message));
      else resolve(String(stdout));
    });
  });
}

/** The task's folder inside the worktree (R16); a folder git does not track has no copy there. */
function inside(path: string, prefix: string): string {
  const cwd = prefix ? join(path, prefix) : path;
  if (!existsSync(cwd)) throw new Error(`${cwd} does not exist in the worktree: git tracks nothing in that folder.`);
  return cwd;
}

/**
 * Worktree workspaces for scheduled tasks. Changes are serialized per
 * repository (R17): siblings starting together would otherwise race on
 * git's locks in the shared git dir.
 */
export class Workspaces {
  private readonly queues = new Map<string, Promise<void>>();

  /** Make (or, on retry, reuse) the task's worktree; resolves the folder the task runs in. */
  async prepareWorktree(req: WorktreeRequest): Promise<string> {
    const repo = await this.repoOf(req.project);
    return this.serial(repo.commonDir, () => this.ensure(repo, req));
  }

  private async repoOf(project: string): Promise<Repo> {
    let out: string;
    try {
      out = await git(project, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--show-prefix", "--git-common-dir"]);
    } catch (err) {
      throw new Error(`${project} is not inside a git repository, so it cannot have a worktree (${(err as Error).message}).`);
    }
    const [toplevel = "", prefix = "", commonDir = ""] = out.split("\n");
    return { toplevel, prefix: prefix.replace(/\/+$/, ""), commonDir };
  }

  private async ensure(repo: Repo, req: WorktreeRequest): Promise<string> {
    const branch = worktreeBranch(req.scheduleId, req.taskId);
    const path = worktreePath(repo.toplevel, req.scheduleId, req.taskId);
    const leftover = (what: string, cleanup: string): Error =>
      new Error(`${what} is left from an earlier run. Press Retry to continue on it, or remove it first: ${cleanup}`);
    const onBranch = parseWorktreeList(await git(repo.toplevel, ["worktree", "list", "--porcelain"])).find(
      (w) => w.branch === branch,
    );
    if (onBranch) {
      if (onBranch.path !== path) throw new Error(`${branch} is checked out in ${onBranch.path}; this task needs it in ${path}.`);
      if (!req.reuse) throw leftover(`The worktree ${path}`, `git worktree remove '${path}' && git branch -D ${branch}`);
      return inside(path, repo.prefix);
    }
    if (existsSync(path)) throw new Error(`${path} already exists and is not this task's worktree. Move it away, or rename the task.`);
    const branchExists = await git(repo.toplevel, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).then(
      () => true,
      () => false,
    );
    if (branchExists && !req.reuse) throw leftover(`The branch ${branch}`, `git branch -D ${branch}`);
    await git(repo.toplevel, branchExists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"]);
    return inside(path, repo.prefix);
  }

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return next;
  }
}
```

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/workspace.test.ts`
Expected: PASS. Each test runs a handful of git processes, so the file takes a few seconds.

- [ ] **Step 5: Lint, typecheck, commit**

Run: `pnpm run lint && pnpm run typecheck`
Expected: clean.

```bash
git add src/node/schedule/workspace.ts src/node/schedule/workspace.test.ts
git commit -m "feat(schedule): worktree workspaces — fresh on a run, reused on retry, git never through a shell (AC-13)"
```

### Task 25: Closing ptys — the kill port, orphans, and the retry close

**Files:**
- Modify: `src/node/schedule/schedule-pty.ts`, test `schedule-pty.test.ts`
- Modify: `src/node/schedule/schedule-runner.ts`, test `schedule-runner.test.ts`
- Modify: `src/node/schedule/spexr-schedule-backend-service.ts`

**Interfaces:**
- Consumes: `Effect` `close` (Task 22); `IShellTerminalServer.close(id)` and `getProcessId(id)` (Theia; `close` kills a `TerminalProcess`).
- Produces: `SchedulePty.close(terminalId: number, processId: number): Promise<void>`; `RunnerPorts.close(terminalId: number, processId: number): Promise<void>`. `perform()` becomes an exhaustive switch, and the start body moves into `private start(scheduleId, runId, e)`.

- [ ] **Step 1: Failing tests**

Append to `schedule-pty.test.ts` (add `SchedulePty` to the import):

```ts
describe("SchedulePty.close", () => {
  function pty(pids: Record<number, number>) {
    const closed: number[] = [];
    const p = new SchedulePty();
    (p as unknown as { terminals: unknown }).terminals = {
      getProcessId: async (id: number) => {
        if (!(id in pids)) throw new Error("gone");
        return pids[id]!;
      },
      close: async (id: number) => void closed.push(id),
    };
    return { p, closed };
  }
  it("closes a terminal that still runs the recorded process", async () => {
    const { p, closed } = pty({ 4: 40 });
    await p.close(4, 40);
    expect(closed).toEqual([4]);
  });
  it("leaves alone a terminal id that now runs another process, or none (R13)", async () => {
    const { p, closed } = pty({ 4: 99 });
    await p.close(4, 40);
    await p.close(5, 50);
    expect(closed).toEqual([]);
  });
});
```

In `schedule-runner.test.ts`, give `fakes()` the port and expose what it saw:

```ts
  const closes: [number, number][] = [];
  // …inside `ports`:
    close: async (id, pid) => void closes.push([id, pid]),
  // …in the returned object:
    closes,
```

At the end of `it("does not bind a rerun's task to the previous run's terminal, …")`, add:

```ts
    expect(f.closes).toEqual([[1, 10]]); // R14: run 1's pty had no card and nothing watching it
```

At the end of `it("drops a superseded run's late started event even when Abort/Run were queued behind a busy queue …")`, add:

```ts
    expect(f.closes).toEqual([[1, 10]]); // R14: dispatch() dropped run 1's "started" and closed its pty
```

Then append, inside `describe("ScheduleRunner", …)`:

```ts
  it("closes a launch that resolves after its run was aborted: it would have no card (R14)", async () => {
    const f = fakes();
    type Terminal = { terminalId: number; processId: number };
    const pending: ((t: Terminal) => void)[] = [];
    f.ports.launch = () => new Promise<Terminal>((resolve) => pending.push(resolve));
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    await runner.abort("s");
    pending.shift()!({ terminalId: 5, processId: 50 });
    await settle();
    expect(f.closes).toEqual([[5, 50]]);
    expect(f.watching()).toBe(false);
  });

  it("closes the pty when its watcher cannot be registered (R14)", async () => {
    const f = fakes();
    f.ports.watchClaude = () => {
      throw new Error("boom");
    };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    expect(f.saved()!.runs["s"]!.tasks["a"]!.status).toBe("failed");
    expect(f.closes).toEqual([[3, 30]]);
  });

  it("a retry closes the failed session and launches a new one; Abort closes nothing (R13)", async () => {
    const f = fakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [schedule], runs: {} });
    await runner.run("s", { a: launch });
    await settle();
    f.exit();
    await settle();
    await runner.dispatch("s", { type: "retry", task: "a", launch });
    await settle();
    expect(f.closes).toEqual([[3, 30]]);
    expect(f.lines).toHaveLength(2);
    expect(f.saved()!.runs["s"]!.tasks["a"]).toMatchObject({ status: "running", terminalId: 3 });
    await runner.abort("s");
    await settle();
    expect(f.closes).toEqual([[3, 30]]); // Abort keeps sessions open (spec)
  });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-pty.test.ts src/node/schedule/schedule-runner.test.ts`
Expected: FAIL. `p.close is not a function`, and `f.closes` stays `[]`.

- [ ] **Step 3: Implement the port**

In `schedule-pty.ts`, add to `SchedulePty`:

```ts
  /**
   * End a task's session, but only while `terminalId` still runs `processId`:
   * terminal ids start over when the backend restarts, and another process's
   * terminal must never be closed (R13). Resolves either way.
   */
  async close(terminalId: number, processId: number): Promise<void> {
    const current = await this.terminals.getProcessId(terminalId).catch(() => -1);
    if (current === processId) await this.terminals.close(terminalId);
  }
```

In `spexr-schedule-backend-service.ts`, add to `ports()`:

```ts
      close: (id, pid) => this.pty.close(id, pid),
```

- [ ] **Step 4: Implement the runner**

In `schedule-runner.ts`:

1. Add to `RunnerPorts`:

```ts
  /** End a pty, only while it still runs `processId` (R13, R14). */
  close(terminalId: number, processId: number): Promise<void>;
```

2. In `dispatch`, replace

```ts
      if (runId !== undefined && prev.runId !== runId) return;
```

with

```ts
      const stale = runId !== undefined && prev.runId !== runId;
      // R14: a pty that started for a run that is gone has no card and nothing watching it.
      if (event.type === "started" && (stale || prev.status !== "running")) await this.closeTerminal(event);
      if (stale) return;
```

3. Replace the whole `perform` method with the three methods below. `start` holds the old body of `perform` from `const schedule = this.schedule(scheduleId);` onwards, with the three marked changes: the `isCurrentRun` comment and its position, the close after a late launch, and the close after a failed registration.

```ts
  private async perform(scheduleId: string, runId: string, e: Effect): Promise<void> {
    switch (e.type) {
      case "name":
        await this.ports.rename(e.sessionId, e.name).catch((err) => console.error("[schedule] renaming the session failed", err));
        return;
      case "paste":
        // Re-armed first: the reply to this paste counts even if it lands between
        // two reads, and the reply still on screen never counts twice (R1).
        this.watches.get(`${scheduleId}/${e.task}`)?.arm();
        await this.ports.paste(e.terminalId, e.text).catch((err) => console.error("[schedule] pasting the follow-up failed", err));
        return;
      case "check":
        await this.check(scheduleId, runId, e);
        return;
      case "close":
        await this.closeTerminal(e);
        return;
      case "start":
        await this.start(scheduleId, runId, e);
        return;
      default: {
        const unknown: never = e;
        throw new Error(`Unknown effect: ${JSON.stringify(unknown)}`);
      }
    }
  }

  /** Close a pty the run no longer wants (R13, R14); the port checks the process id first. */
  private async closeTerminal(t: { terminalId: number; processId: number }): Promise<void> {
    await this.ports.close(t.terminalId, t.processId).catch((err) => console.error("[schedule] closing a session failed", err));
  }

  /** Launch a task's pty and register its watcher and exit listener; every outcome goes back through dispatch(), bound to `runId`. */
  private async start(scheduleId: string, runId: string, e: Extract<Effect, { type: "start" }>): Promise<void> {
    const schedule = this.schedule(scheduleId);
    const task = schedule?.tasks.find((t) => t.id === e.task);
    const run = this.file.runs[scheduleId];
    const launch = task && run?.launches[task.id];
    // Bound to this run: dispatch() drops it inside the queue if Abort→Run has since replaced run `runId`.
    const send = (event: EngineEvent): void => {
      void this.dispatch(scheduleId, event, runId).catch((err) => console.error("[schedule] dispatch failed", err));
    };
    // An early-out only: it reads `this.file` outside the queue, so on a busy
    // queue it can still see a superseded run as current and register a
    // watcher for it. Abort's commit() releases that registration, and
    // dispatch() drops the stale "started" and closes its pty (R14).
    const isCurrentRun = (): boolean => {
      const current = this.file.runs[scheduleId];
      return !!current && current.runId === runId && current.status === "running";
    };
    if (!schedule || !task || !run || !launch) {
      send({ type: "start-failed", task: e.task, error: "The task is no longer in the schedule." });
      return;
    }
    const workspace =
      task.workspace.kind === "sameAs" ? (run.tasks[task.workspace.task]?.workspace ?? task.project) : task.project;
    const sessionId = task.harness === "claude" ? this.ports.newSessionId() : undefined;
    const line = buildLaunchLine({
      plan: launch.plan,
      args: buildTaskArgs(task, e.prompt, sessionId),
      cwd: workspace,
      ownsAccount: task.harness === "claude",
      keepShell: false,
    });
    let terminal: { terminalId: number; processId: number };
    try {
      terminal = await this.ports.launch(line, workspace);
    } catch (err) {
      if (!isCurrentRun()) return;
      send({ type: "start-failed", task: task.id, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!isCurrentRun()) {
      // R14: the run was aborted or replaced while this pty started; it has no card and no watcher.
      await this.closeTerminal(terminal);
      return;
    }
    const onWatch = (w: WatchEvent): void => send({ ...w, task: task.id } as EngineEvent);
    const registered: (() => void)[] = [];
    let watch: TaskWatch;
    try {
      watch =
        task.harness === "claude"
          ? this.ports.watchClaude(
              {
                sessionId: sessionId!,
                configDir: launch.configDir,
                ...(task.permissionMode ? { permissionMode: task.permissionMode } : {}),
              },
              onWatch,
            )
          : this.ports.watchOpencode({ workspace, ...(task.permissionMode ? { permissionMode: task.permissionMode } : {}) }, onWatch);
      registered.push(() => watch.stop());
      const stopExit = this.ports.onExit(terminal.terminalId, () => send({ type: "exited", task: task.id }));
      registered.push(stopExit);
    } catch (err) {
      for (const stop of registered) stop();
      send({ type: "start-failed", task: task.id, error: err instanceof Error ? err.message : String(err) });
      await this.closeTerminal(terminal); // R14: nothing would ever watch it
      return;
    }
    this.registerReleases(scheduleId, task.id, registered);
    this.watches.set(`${scheduleId}/${task.id}`, watch);
    send({ type: "started", task: task.id, ...terminal, workspace, ...(sessionId ? { sessionId } : {}) });
  }
```

- [ ] **Step 5: Run to see them pass**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck, commit**

Run: `pnpm run lint && pnpm run typecheck`
Expected: clean.

```bash
git add src/node/schedule/schedule-pty.ts src/node/schedule/schedule-pty.test.ts src/node/schedule/schedule-runner.ts src/node/schedule/schedule-runner.test.ts src/node/schedule/spexr-schedule-backend-service.ts
git commit -m "feat(schedule): close orphaned and retried task ptys, checked by process id (R13, R14)"
```

### Task 26: Runner and service — workspaces, retry and skip

**Files:**
- Modify: `src/node/schedule/schedule-runner.ts`, test `schedule-runner.test.ts`
- Modify: `src/common/schedule/schedule-protocol.ts`
- Modify: `src/node/schedule/spexr-schedule-backend-service.ts`

**Interfaces:**
- Consumes: `workspacePlan` (Task 23); `Workspaces`, `WorktreeRequest` (Task 24); `RETRYABLE_STATUSES`, the `retry` and `skip` events (Task 22).
- Produces:

```ts
// RunnerPorts
prepareWorktree(req: WorktreeRequest): Promise<string>;
// ScheduleRunner
retry(scheduleId: string, taskId: string, launch: TaskLaunch): Promise<ValidationProblem[]>;
skip(scheduleId: string, taskId: string): Promise<ValidationProblem[]>;
// SpexrScheduleService (protocol) — same two signatures
```

- [ ] **Step 1: Failing tests**

In `schedule-runner.test.ts`:
- add `import type { WorktreeRequest } from "./workspace.js";`;
- add `prepareWorktree: async (req) => \`/wt/${req.taskId}\`,` to the `ports` of `fakes()`;
- append:

```ts
describe("ScheduleRunner — the graph (Slice 4)", () => {
  type Terminal = { terminalId: number; processId: number };
  const graph: Schedule = {
    id: "s",
    name: "S",
    tasks: [
      { id: "a", name: "A", needs: [], project: "/repo", workspace: { kind: "worktree" }, harness: "claude", prompt: "do a" },
      { id: "b", name: "B", needs: [], project: "/repo", workspace: { kind: "worktree" }, harness: "claude", prompt: "do b" },
      { id: "c", name: "C", needs: ["a"], project: "/repo", workspace: { kind: "sameAs", task: "a" }, harness: "claude", prompt: "review {{a.workspace}}" },
    ],
  };
  const all = { a: launch, b: launch, c: launch };
  const sessionIn = (line: string): string => /'--session-id' '([^']+)'/.exec(line)![1]!;

  function graphFakes() {
    const launched: { line: string; cwd: string; resolve: (t: Terminal) => void }[] = [];
    const worktrees: WorktreeRequest[] = [];
    const watchers = new Map<string, (e: WatchEvent) => void>();
    const exits = new Map<number, () => void>();
    const closes: [number, number][] = [];
    let sessions = 0;
    let saved: ScheduleFile | undefined;
    const ports: RunnerPorts = {
      launch: (line, cwd) => new Promise<Terminal>((resolve) => launched.push({ line, cwd, resolve })),
      onExit: (id, l) => (exits.set(id, l), () => void exits.delete(id)),
      watchClaude: (req, l) => (watchers.set(req.sessionId, l), { stop: () => void watchers.delete(req.sessionId), arm: () => {} }),
      watchOpencode: () => ({ stop: () => {}, arm: () => {} }),
      rename: async () => {},
      newSessionId: () => `u-${++sessions}`,
      now: () => 1,
      save: async (f) => void (saved = structuredClone(f)),
      publish: () => {},
      paste: async () => {},
      check: async () => ({ ok: true, tail: "" }),
      close: async (id, pid) => void closes.push([id, pid]),
      prepareWorktree: async (req) => (worktrees.push(req), `/wt/${req.taskId}`),
    };
    return {
      ports,
      launched,
      worktrees,
      exits,
      closes,
      /** Report a turn end on the session the launch `line` started. */
      turnEnded: (line: string, reply: string) => watchers.get(sessionIn(line))!({ type: "turn-ended", reply }),
      run: () => saved!.runs["s"]!,
    };
  }
  /** Run the graph and let both roots start: a on terminal 1, b on terminal 2. */
  async function running(f: ReturnType<typeof graphFakes>): Promise<ScheduleRunner> {
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [graph], runs: {} });
    expect(await runner.run("s", all)).toEqual([]);
    await settle();
    f.launched[0]!.resolve({ terminalId: 1, processId: 10 });
    f.launched[1]!.resolve({ terminalId: 2, processId: 20 });
    await settle();
    return runner;
  }

  it("starts two siblings in separate worktrees together, both launched before either has started (AC-12, AC-13)", async () => {
    const f = graphFakes();
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [graph], runs: {} });
    expect(await runner.run("s", all)).toEqual([]); // Slice 2's "worktree arrives in Slice 4" refusal is gone
    await settle();
    expect(f.worktrees).toEqual([
      { project: "/repo", scheduleId: "s", taskId: "a", reuse: false },
      { project: "/repo", scheduleId: "s", taskId: "b", reuse: false },
    ]);
    expect(f.launched.map((l) => l.cwd)).toEqual(["/wt/a", "/wt/b"]); // both in flight, neither resolved
    expect(f.launched[0]!.line).toContain(`cd '/wt/a'`);
    expect(f.run().tasks["a"]!.status).toBe("starting");
    expect(f.run().tasks["b"]!.status).toBe("starting");
  });

  it("runs a sameAs task in its upstream's real worktree and makes none of its own (AC-13, R20)", async () => {
    const f = graphFakes();
    await running(f);
    f.turnEnded(f.launched[0]!.line, "done");
    await settle();
    expect(f.launched[2]!.cwd).toBe("/wt/a");
    expect(f.launched[2]!.line).toContain(`'review /wt/a'`);
    expect(f.worktrees.map((w) => w.taskId)).toEqual(["a", "b"]);
  });

  it("retry reuses the task's worktree, closes the failed session and launches a new one (R13, R15)", async () => {
    const f = graphFakes();
    const runner = await running(f);
    f.exits.get(2)!();
    await settle();
    expect(f.run()).toMatchObject({ pausedBy: "failure", tasks: { b: { status: "failed" } } });
    expect(await runner.retry("s", "b", launch)).toEqual([]);
    await settle();
    expect(f.closes).toEqual([[2, 20]]);
    expect(f.worktrees[f.worktrees.length - 1]).toEqual({ project: "/repo", scheduleId: "s", taskId: "b", reuse: true });
    expect(f.launched[2]!.cwd).toBe("/wt/b");
    expect(f.run().tasks["b"]!.status).toBe("starting");
    expect(f.run().pausedBy).toBeUndefined();
  });

  it("skip lets the dependent start: it still shares the folder, but the placeholders arrive empty (AC-14)", async () => {
    const f = graphFakes();
    const runner = await running(f);
    f.exits.get(1)!();
    await settle();
    expect(await runner.skip("s", "a")).toEqual([]);
    await settle();
    expect(f.run().tasks["a"]!.status).toBe("skipped");
    expect(f.launched[2]!.cwd).toBe("/wt/a");
    expect(f.launched[2]!.line).toContain(`'review '`);
    expect(f.closes).toEqual([]); // R13: skip leaves the failed session open
  });

  it("fails a sameAs task whose upstream never got its worktree, instead of using the project folder (R20)", async () => {
    const f = graphFakes();
    f.ports.prepareWorktree = async (req) => {
      if (req.taskId === "a") throw new Error("/repo is not inside a git repository");
      return `/wt/${req.taskId}`;
    };
    const runner = new ScheduleRunner(f.ports, { version: 1, schedules: [graph], runs: {} });
    await runner.run("s", all);
    await settle();
    expect(f.run().tasks["a"]).toMatchObject({ status: "failed", error: "/repo is not inside a git repository" });
    await runner.skip("s", "a");
    await settle();
    expect(f.run().tasks["c"]).toMatchObject({ status: "failed", error: expect.stringContaining("never got its worktree") });
    expect(f.launched.map((l) => l.cwd)).toEqual(["/wt/b"]);
  });

  it("refuses retry and skip on a task that is not failed or interrupted, a bad launch, or a run that is over (R21)", async () => {
    const f = graphFakes();
    const runner = await running(f);
    const notFailed = [{ task: "a", field: "run", message: "Only a failed or interrupted task can be retried or skipped." }];
    expect(await runner.retry("s", "a", launch)).toEqual(notFailed);
    expect(await runner.skip("s", "a")).toEqual(notFailed);
    f.exits.get(1)!();
    await settle();
    const bad: TaskLaunch = { ...launch, plan: { ...launch.plan, command: "claude\nrm -rf ~" } };
    expect(await runner.retry("s", "a", bad)).toEqual([{ field: "run", message: "A task has no usable launch command." }]);
    await runner.abort("s");
    expect(await runner.skip("s", "a")).toEqual([{ field: "run", message: "This schedule is not running." }]);
    expect(f.launched).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/schedule-runner.test.ts`
Expected: FAIL. Run answers `[{ field: "workspace", message: "Worktree workspaces arrive with the full graph (Slice 4)." }]`, and `runner.retry` is not a function.

- [ ] **Step 3: Implement the runner**

In `schedule-runner.ts`:

1. Imports: add `RETRYABLE_STATUSES` and `type ScheduleTask` to the `schedule-types.js` import. Import `workspacePlan` from `./schedule-engine.js`, and `import type { WorktreeRequest } from "./workspace.js";`.
2. Add to `RunnerPorts`:

```ts
  /** Make (or, with `reuse`, find again) a worktree task's worktree; resolves the folder the task runs in. */
  prepareWorktree(req: WorktreeRequest): Promise<string>;
```

3. Below the imports, add:

```ts
/** Why the backend will not use a launch the frontend resolved (spec, Security), or undefined. */
function launchProblem(launch: TaskLaunch | undefined): ValidationProblem | undefined {
  if (launch?.plan.command.trim() && !/[\n\r]/.test(launch.plan.command)) return undefined;
  return { field: "run", message: "A task has no usable launch command." };
}
```

4. In `run()`, replace the worktree refusal and the launch-command check (the two `if (schedule.tasks.some(…))` blocks) with:

```ts
      const bad = schedule.tasks.map((t) => launchProblem(launches[t.id])).find((x) => x !== undefined);
      if (bad) return [bad];
```

5. After `resume()`, add:

```ts
  /**
   * Start a failed or interrupted task again from iteration 1 in the same
   * workspace, with the launch the frontend resolved just now (R11–R13, R15,
   * R22). Returns why not instead (R21).
   */
  retry(scheduleId: string, taskId: string, launch: TaskLaunch): Promise<ValidationProblem[]> {
    return this.serial(async () => {
      const problem = this.taskActionProblem(scheduleId, taskId) ?? launchProblem(launch);
      if (problem) return [problem];
      await this.stepNow(scheduleId, { type: "retry", task: taskId, launch });
      return [];
    });
  }

  /** Let a failed or interrupted task's dependents start without it; returns why not instead (R21). */
  skip(scheduleId: string, taskId: string): Promise<ValidationProblem[]> {
    return this.serial(async () => {
      const problem = this.taskActionProblem(scheduleId, taskId);
      if (problem) return [problem];
      await this.stepNow(scheduleId, { type: "skip", task: taskId });
      return [];
    });
  }

  /** Why retry or skip cannot apply (R21); read inside the queue, against the state it would change. */
  private taskActionProblem(scheduleId: string, taskId: string): ValidationProblem | undefined {
    const run = this.file.runs[scheduleId];
    if (!this.schedule(scheduleId) || run?.status !== "running") return { field: "run", message: "This schedule is not running." };
    const state = run.tasks[taskId];
    if (!state || !RETRYABLE_STATUSES.has(state.status)) {
      return { task: taskId, field: "run", message: "Only a failed or interrupted task can be retried or skipped." };
    }
    return undefined;
  }

  /** Apply an operator event from inside the queue; dispatch() would queue behind the caller and never run. */
  private async stepNow(scheduleId: string, event: EngineEvent): Promise<void> {
    const { run, effects } = step(this.schedule(scheduleId)!, this.file.runs[scheduleId]!, event);
    await this.commit(scheduleId, run, effects);
  }

  /** The folder a task runs in (R20): its project, its worktree (made or reused, R15), or its upstream's real folder. */
  private async workspaceFor(schedule: Schedule, run: RunState, task: ScheduleTask, reuse: boolean): Promise<string> {
    const plan = workspacePlan(schedule, run, task.id);
    if (plan.kind === "path") return plan.path;
    if (plan.kind === "missing") throw new Error(plan.reason);
    return this.ports.prepareWorktree({ project: task.project, scheduleId: schedule.id, taskId: task.id, reuse });
  }
```

6. In `start()`, replace

```ts
    const workspace =
      task.workspace.kind === "sameAs" ? (run.tasks[task.workspace.task]?.workspace ?? task.project) : task.project;
```

with

```ts
    let workspace: string;
    try {
      workspace = await this.workspaceFor(schedule, run, task, e.reuse === true);
    } catch (err) {
      if (isCurrentRun()) send({ type: "start-failed", task: task.id, error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (!isCurrentRun()) return;
```

- [ ] **Step 4: Protocol and service**

In `schedule-protocol.ts`, add to `SpexrScheduleService` after `resume`:

```ts
  /** Start a failed or interrupted task again, from iteration 1, in the same workspace; returns why not instead. */
  retry(scheduleId: string, taskId: string, launch: TaskLaunch): Promise<ValidationProblem[]>;
  /** Let a failed or interrupted task's dependents start without it (its hand-offs arrive empty); returns why not instead. */
  skip(scheduleId: string, taskId: string): Promise<ValidationProblem[]>;
```

In `spexr-schedule-backend-service.ts`:

```ts
import { Workspaces } from "./workspace.js";
// fields:
  /** One per backend (the service is a singleton): worktree changes are serialized per repository (R17). */
  private readonly workspaces = new Workspaces();
// methods, after resume():
  async retry(scheduleId: string, taskId: string, launch: TaskLaunch): Promise<ValidationProblem[]> {
    return (await this.runner).retry(scheduleId, taskId, launch);
  }

  async skip(scheduleId: string, taskId: string): Promise<ValidationProblem[]> {
    return (await this.runner).skip(scheduleId, taskId);
  }
// ports():
      prepareWorktree: (req) => this.workspaces.prepareWorktree(req),
```

- [ ] **Step 5: Run to see them pass**

Run: `npx vitest run --maxWorkers=2 src/node/schedule/ src/common/schedule/`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck, commit**

Run: `pnpm run lint && pnpm run typecheck`
Expected: clean. The frontend only holds a proxy of `SpexrScheduleService`, so nothing there has to implement the new methods yet.

```bash
git add src/node/schedule/schedule-runner.ts src/node/schedule/schedule-runner.test.ts src/common/schedule/schedule-protocol.ts src/node/schedule/spexr-schedule-backend-service.ts
git commit -m "feat(schedule): worktree and sameAs workspaces, retry and skip in the runner and service (AC-13..AC-15)"
```

### Task 27: A failed re-attach disposes the widget it made

A retried task's card is mounted by its new terminal id through `reattach`. When `term.start` throws there, the widget is left registered with the terminal service under `spexr-df-<key>`. This settles the Task 12 deferred minor.

**Files:**
- Modify: `src/browser/darkfactory/darkfactory-terminal-manager.ts`
- Test: `src/browser/darkfactory/darkfactory-terminal-manager.test.ts`

**Interfaces:** `reattach` keeps its signature; on a failed start it now disposes the widget before it returns `undefined`.

- [ ] **Step 1: Failing test**

Append inside `describe("SpexrDarkfactoryTerminalManager across a window reload", …)`:

```ts
  it("disposes the widget it made when the attach itself fails, so a later attach under the key starts clean", async () => {
    const { manager, terms } = withServer({ 7: 4242 });
    const service = (manager as unknown as { terminalService: { newTerminal: (o: Record<string, unknown>) => FakeTerminal } })
      .terminalService;
    const make = service.newTerminal;
    service.newTerminal = (o) => {
      const t = make(o);
      t.start = async () => {
        throw new Error("gone");
      };
      return t;
    };
    expect(await manager.reattach(UUID, { terminalId: 7, processId: 4242 }, "/Users/x/proj")).toBeUndefined();
    expect(terms[0]!.isDisposed).toBe(true);
    expect(manager.live(UUID)).toBeUndefined();
  });
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/darkfactory-terminal-manager.test.ts`
Expected: FAIL. `isDisposed` is `false`.

- [ ] **Step 3: Implement**

In `reattach`, replace the `catch` block:

```ts
    } catch {
      // The process ended in between. The widget's id is derived from the key,
      // so a stale one would collide with the next attach under it.
      term.dispose();
      return undefined;
    }
```

- [ ] **Step 4: Run, lint, typecheck, commit**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/darkfactory-terminal-manager.test.ts && pnpm run lint && pnpm run typecheck`
Expected: PASS, clean.

```bash
git add src/browser/darkfactory/darkfactory-terminal-manager.ts src/browser/darkfactory/darkfactory-terminal-manager.test.ts
git commit -m "fix(darkfactory): a failed re-attach disposes the terminal widget it created"
```

### Task 28: Editor view model — waits for, workspace, hand-offs, account

**Files:**
- Create: `src/browser/darkfactory/schedule/task-edit.ts`
- Test: `src/browser/darkfactory/schedule/task-edit.test.ts`

**Interfaces:**
- Consumes: `upstreamOf` (Task 1); `ClaudeConfigDir` (`common/darkfactory-protocol.ts`).
- Produces:

```ts
export interface Choice { value: string; label: string }
export interface NeedChoice { id: string; name: string; checked: boolean; blockedBy?: string }
export function needChoices(schedule: Schedule, taskId: string): NeedChoice[];            // R23
export function withNeed(task: ScheduleTask, id: string, on: boolean): ScheduleTask;
export function workspaceOptions(schedule: Schedule, taskId: string): Choice[];         // only upstream sameAs
export function workspaceValue(ws: TaskWorkspace): string;
export function withWorkspace(task: ScheduleTask, value: string): ScheduleTask;
export function placeholderChoices(schedule: Schedule, taskId: string): { token: string; label: string }[];
export function insertAt(text: string, start: number, end: number, token: string): { text: string; caret: number };
export function accountOptions(configs: readonly ClaudeConfigDir[], current: string | undefined): Choice[];
export function withAccount(task: ScheduleTask, configDir: string): ScheduleTask;
```

- [ ] **Step 1: Failing tests**

```ts
// src/browser/darkfactory/schedule/task-edit.test.ts
import { describe, expect, it } from "vitest";
import type { Schedule, ScheduleTask } from "../../../common/schedule/schedule-types.js";
import {
  accountOptions,
  insertAt,
  needChoices,
  placeholderChoices,
  withAccount,
  withNeed,
  withWorkspace,
  workspaceOptions,
  workspaceValue,
} from "./task-edit.js";

const t = (id: string, needs: string[] = []): ScheduleTask => ({
  id, name: id.toUpperCase(), needs, project: "/r", workspace: { kind: "folder" }, harness: "claude", prompt: "p",
});
const s: Schedule = { id: "s", name: "S", tasks: [t("a"), t("b", ["a"]), t("c", ["b"]), t("d")] };

describe("waits for", () => {
  it("offers every other task, blocking the ones that already wait for this one (R23)", () => {
    expect(needChoices(s, "a")).toEqual([
      { id: "b", name: "B", checked: false, blockedBy: "B already waits for this task." },
      { id: "c", name: "C", checked: false, blockedBy: "C already waits for this task." },
      { id: "d", name: "D", checked: false },
    ]);
    expect(needChoices(s, "c").map((n) => [n.id, n.checked, n.blockedBy])).toEqual([
      ["a", false, undefined],
      ["b", true, undefined],
      ["d", false, undefined],
    ]);
  });
  it("adds and removes a link without duplicates", () => {
    expect(withNeed(t("c", ["b"]), "a", true).needs).toEqual(["b", "a"]);
    expect(withNeed(t("c", ["b"]), "b", true).needs).toEqual(["b"]);
    expect(withNeed(t("c", ["b", "a"]), "b", false).needs).toEqual(["a"]);
  });
});

describe("workspace", () => {
  it("offers the folder, a worktree, and only the tasks upstream of this one", () => {
    expect(workspaceOptions(s, "c").map((o) => o.value)).toEqual(["folder", "worktree", "sameAs:a", "sameAs:b"]);
    expect(workspaceOptions(s, "c")[2]!.label).toBe("Same as A");
    expect(workspaceOptions(s, "d").map((o) => o.value)).toEqual(["folder", "worktree"]);
  });
  it("round-trips the choice", () => {
    for (const v of ["folder", "worktree", "sameAs:a"]) expect(workspaceValue(withWorkspace(t("c"), v).workspace)).toBe(v);
    expect(withWorkspace(t("c"), "sameAs:a").workspace).toEqual({ kind: "sameAs", task: "a" });
  });
});

describe("hand-offs", () => {
  it("lists each upstream task's reply and folder, in schedule order, and nothing without upstream", () => {
    expect(placeholderChoices(s, "c").map((h) => h.token)).toEqual(["{{a.reply}}", "{{a.workspace}}", "{{b.reply}}", "{{b.workspace}}"]);
    expect(placeholderChoices(s, "c")[0]!.label).toBe("A: final reply");
    expect(placeholderChoices(s, "a")).toEqual([]);
  });
  it("inserts at the caret, replacing a selection, and clamps out-of-range positions", () => {
    expect(insertAt("see  now", 4, 4, "{{a.reply}}")).toEqual({ text: "see {{a.reply}} now", caret: 15 });
    expect(insertAt("see XX now", 4, 6, "T")).toEqual({ text: "see T now", caret: 5 });
    expect(insertAt("ab", 9, 12, "T")).toEqual({ text: "abT", caret: 3 });
  });
});

describe("account", () => {
  const configs = [
    { path: "/u/.claude", label: ".claude", isDefault: true },
    { path: "/u/.claude-work", label: ".claude-work", isDefault: false },
  ];
  it("offers the default account and every known one, keeping an unknown current choice visible", () => {
    expect(accountOptions(configs, undefined)).toEqual([
      { value: "", label: "Default account" },
      { value: "/u/.claude", label: ".claude (default)" },
      { value: "/u/.claude-work", label: ".claude-work" },
    ]);
    expect(accountOptions(configs, "/gone")[3]).toEqual({ value: "/gone", label: "/gone (not found)" });
  });
  it("the default account drops the setting instead of storing an empty path", () => {
    expect(withAccount(t("a"), "/u/.claude-work").configDir).toBe("/u/.claude-work");
    expect("configDir" in withAccount({ ...t("a"), configDir: "/x" }, "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/schedule/task-edit.test.ts`
Expected: FAIL. `Cannot find module './task-edit.js'`.

- [ ] **Step 3: Implement**

```ts
// src/browser/darkfactory/schedule/task-edit.ts
import type { ClaudeConfigDir } from "../../../common/darkfactory-protocol.js";
import type { Schedule, ScheduleTask, TaskWorkspace } from "../../../common/schedule/schedule-types.js";
import { upstreamOf } from "../../../common/schedule/schedule-graph.js";

export interface Choice {
  value: string;
  label: string;
}

export interface NeedChoice {
  id: string;
  name: string;
  checked: boolean;
  /** Why it cannot be chosen: that task already waits for this one, so choosing it would close a cycle (R23). */
  blockedBy?: string;
}

/** The other tasks this one may wait for; a task downstream of it is offered but blocked, with why. */
export function needChoices(schedule: Schedule, taskId: string): NeedChoice[] {
  const task = schedule.tasks.find((x) => x.id === taskId);
  return schedule.tasks
    .filter((x) => x.id !== taskId)
    .map((x) => {
      const checked = task?.needs.includes(x.id) ?? false;
      const downstream = !checked && upstreamOf(schedule, x.id).has(taskId);
      return { id: x.id, name: x.name, checked, ...(downstream ? { blockedBy: `${x.name} already waits for this task.` } : {}) };
    });
}

/** Add or remove one "waits for" link. */
export function withNeed(task: ScheduleTask, id: string, on: boolean): ScheduleTask {
  if (on) return task.needs.includes(id) ? task : { ...task, needs: [...task.needs, id] };
  return { ...task, needs: task.needs.filter((x) => x !== id) };
}

/** The project folder, a new worktree, or the workspace of a task this one waits for — never of any other (spec, Sidebar). */
export function workspaceOptions(schedule: Schedule, taskId: string): Choice[] {
  const up = upstreamOf(schedule, taskId);
  return [
    { value: "folder", label: "Project folder" },
    { value: "worktree", label: "New worktree" },
    ...schedule.tasks.filter((x) => up.has(x.id)).map((x) => ({ value: `sameAs:${x.id}`, label: `Same as ${x.name}` })),
  ];
}

export function workspaceValue(ws: TaskWorkspace): string {
  return ws.kind === "sameAs" ? `sameAs:${ws.task}` : ws.kind;
}

export function withWorkspace(task: ScheduleTask, value: string): ScheduleTask {
  const workspace: TaskWorkspace =
    value === "worktree"
      ? { kind: "worktree" }
      : value.startsWith("sameAs:")
        ? { kind: "sameAs", task: value.slice("sameAs:".length) }
        : { kind: "folder" };
  return { ...task, workspace };
}

/** The hand-offs a prompt may use: each upstream task's reply and folder, in schedule order (spec, Hand-off). */
export function placeholderChoices(schedule: Schedule, taskId: string): { token: string; label: string }[] {
  const up = upstreamOf(schedule, taskId);
  return schedule.tasks
    .filter((x) => up.has(x.id))
    .flatMap((x) => [
      { token: `{{${x.id}.reply}}`, label: `${x.name}: final reply` },
      { token: `{{${x.id}.workspace}}`, label: `${x.name}: folder` },
    ]);
}

/** Put `token` in place of the selection `start..end`; returns the text and where the caret goes. */
export function insertAt(text: string, start: number, end: number, token: string): { text: string; caret: number } {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  return { text: text.slice(0, a) + token + text.slice(b), caret: a + token.length };
}

/** "Default account", then every account the launcher knows; a stored one no longer found stays visible. */
export function accountOptions(configs: readonly ClaudeConfigDir[], current: string | undefined): Choice[] {
  const options: Choice[] = [
    { value: "", label: "Default account" },
    ...configs.map((c) => ({ value: c.path, label: c.isDefault ? `${c.label} (default)` : c.label })),
  ];
  if (current && !configs.some((c) => c.path === current)) options.push({ value: current, label: `${current} (not found)` });
  return options;
}

/** Pick the Claude account; "" is the default and drops the key (exactOptionalPropertyTypes). */
export function withAccount(task: ScheduleTask, configDir: string): ScheduleTask {
  if (configDir) return { ...task, configDir };
  const { configDir: _dropped, ...rest } = task;
  return rest;
}
```

- [ ] **Step 4: Run, lint, typecheck, commit**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/schedule/ && pnpm run lint && pnpm run typecheck`
Expected: PASS, clean.

```bash
git add src/browser/darkfactory/schedule/task-edit.ts src/browser/darkfactory/schedule/task-edit.test.ts
git commit -m "feat(schedule): editor view model for waits-for, workspace, hand-offs and account"
```

### Task 29: Row view model — workspace, Retry/Skip, bands, upstream, duplicate

**Files:**
- Modify: `src/browser/darkfactory/schedule/schedule-view.ts`
- Test: `src/browser/darkfactory/schedule/schedule-view.test.ts`

**Interfaces:**
- Consumes: `upstreamOf` (Task 1); `RETRYABLE_STATUSES` (Task 22).
- Produces: `TaskRow` gains `workspace: string`, `canRetry: boolean` and `session?: string`. New exports:

```ts
export function bandsOf(rows: readonly TaskRow[]): { layer: number; rows: TaskRow[] }[];
export function upstreamHighlight(schedule: Schedule, selected: string | undefined): ReadonlySet<string>;
export function duplicateSchedule(s: Schedule, taken: ReadonlySet<string>): Schedule;
```

- [ ] **Step 1: Failing tests**

Add `bandsOf`, `duplicateSchedule` and `upstreamHighlight` to the import from `./schedule-view.js`, then append:

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/schedule/schedule-view.test.ts`
Expected: FAIL. `bandsOf` is not exported, and `workspace` is undefined.

- [ ] **Step 3: Implement**

In `schedule-view.ts`:

1. Imports: add `RETRYABLE_STATUSES` to the `schedule-types.js` import, and `upstreamOf` to the `schedule-graph.js` import.
2. In `TaskRow`, after `waitsFor: string[];`, add:

```ts
  /** Where it works: "Project folder", "Worktree" or "Same as <task>". */
  workspace: string;
```

and after `unattended: boolean;`, add:

```ts
  /** Failed or interrupted in a running run: Retry and Skip apply (R21). */
  canRetry: boolean;
  /** The opencode session the runner adopted, shown so a wrong pick-up is visible (spec, Risks). */
  session?: string;
```

3. In `taskRows`, add `const live = run?.status === "running";` before `return order.map(…)`. In the returned object, add `workspace: workspaceLabel(t, byId),` after `waitsFor: …,`, and add these after `unattended: …,`:

```ts
      canRetry: live && RETRYABLE_STATUSES.has(status),
      ...(t.harness === "opencode" && state?.sessionId ? { session: state.sessionId } : {}),
```

4. Add:

```ts
function workspaceLabel(t: ScheduleTask, byId: ReadonlyMap<string, ScheduleTask>): string {
  switch (t.workspace.kind) {
    case "folder":
      return "Project folder";
    case "worktree":
      return "Worktree";
    case "sameAs":
      return `Same as ${byId.get(t.workspace.task)?.name ?? t.workspace.task}`;
  }
}

/** Rows grouped into their layer's band, in order; taskRows() already sorts them by layer. */
export function bandsOf(rows: readonly TaskRow[]): { layer: number; rows: TaskRow[] }[] {
  const bands: { layer: number; rows: TaskRow[] }[] = [];
  for (const r of rows) {
    const last = bands[bands.length - 1];
    if (last?.layer === r.layer) last.rows.push(r);
    else bands.push({ layer: r.layer, rows: [r] });
  }
  return bands;
}

/** The tasks the selected one waits for, directly or not: the rows to highlight. */
export function upstreamHighlight(schedule: Schedule, selected: string | undefined): ReadonlySet<string> {
  return selected ? upstreamOf(schedule, selected) : new Set<string>();
}

/** A deep copy under a free id, named "<name> (copy)"; its worktrees get their own branches, since those carry the id. */
export function duplicateSchedule(s: Schedule, taken: ReadonlySet<string>): Schedule {
  return { ...structuredClone(s), id: newSchedule(taken).id, name: `${s.name} (copy)` };
}
```

- [ ] **Step 4: Run, lint, typecheck, commit**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/schedule/ && pnpm run lint && pnpm run typecheck`
Expected: PASS, clean.

```bash
git add src/browser/darkfactory/schedule/schedule-view.ts src/browser/darkfactory/schedule/schedule-view.test.ts
git commit -m "feat(schedule): rows show workspace, Retry/Skip, adopted session; bands, upstream highlight, duplicate"
```

### Task 30: Sidebar editor — waits for, workspace, hand-offs, account, inline problems

**Files:**
- Modify: `src/browser/darkfactory/schedule/schedule-sidebar.tsx`
- Modify: `src/browser/darkfactory/darkfactory-wall-widget.tsx`
- Modify: `src/browser/style/spexr.css`

**Interfaces:**
- Consumes: everything in `task-edit.ts` (Task 28); `ClaudeConfigDir`.
- Produces: `ScheduleSidebarProps.configs: readonly ClaudeConfigDir[]`; `TaskEditor` takes `schedule` and `configs`.

Write this task against `schedule-sidebar.tsx` as of commit `66545b6`, with the targeted edits below. Never replace the whole file.

- [ ] **Step 1: Props and imports**

1. Add the imports:

```ts
import type { ClaudeConfigDir } from "../../../common/darkfactory-protocol.js";
import {
  accountOptions,
  insertAt,
  needChoices,
  placeholderChoices,
  withAccount,
  withNeed,
  withWorkspace,
  workspaceOptions,
  workspaceValue,
} from "./task-edit.js";
```

2. In `ScheduleSidebarProps`, after `projects: …;`, add:

```ts
  /** The Claude accounts the wall's launcher knows; a task picks one. */
  configs: readonly ClaudeConfigDir[];
```

3. In the `<TaskEditor` call, add `schedule={schedule}` and `configs={p.configs}`. In `TaskEditor`'s props type, after `task: ScheduleTask;`, add `schedule: Schedule;` and `configs: readonly ClaudeConfigDir[];`.

- [ ] **Step 2: Schedule name, inline**

In `ScheduleSidebar`, after `const bar = …;`, add:

```ts
  const nameProblem = problems.find((x) => !x.task && x.field === "name")?.message;
```

Replace the schedule Name `<label className="sl-field">…</label>` (the one holding `value={schedule.name}`) with:

```tsx
          <label className="sl-field" data-invalid={nameProblem ? "true" : undefined}>
            <span className="sl-field__label">Name</span>
            <span className="sl-field__control">
              <input
                className="sl-field__input"
                value={schedule.name}
                disabled={running}
                aria-invalid={nameProblem ? true : undefined}
                onChange={(e) => edit({ ...schedule, name: e.target.value })}
                onBlur={flush}
              />
            </span>
            {nameProblem && <span className="spexr-sched__problem">{nameProblem}</span>}
          </label>
```

- [ ] **Step 3: Editor fields**

In `TaskEditor`, directly after `const set = (patch: Partial<ScheduleTask>): void => …;`, add:

```ts
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null);
  const handOffs = placeholderChoices(p.schedule, t.id);
  const needs = needChoices(p.schedule, t.id);
  const current = workspaceValue(t.workspace);
  const workspaces = workspaceOptions(p.schedule, t.id);
  // A sameAs left pointing at a task this one no longer waits for stays visible; validation flags it next to the field.
  if (!workspaces.some((o) => o.value === current)) workspaces.push({ value: current, label: "Same as a task it does not wait for" });
  /** Insert a hand-off at the caret (R23: buttons, so arrowing never inserts), then put the caret after it. */
  const insertHandOff = (token: string): void => {
    const el = promptRef.current;
    const { text, caret } = insertAt(t.prompt, el?.selectionStart ?? t.prompt.length, el?.selectionEnd ?? t.prompt.length, token);
    set({ prompt: text });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };
```

After the `{field("Project", …)}` call, insert:

```tsx
      {field(
        "Workspace",
        "workspace",
        <span className="sl-select">
          <select className="sl-field__input" value={current} onChange={(e) => p.onChange(withWorkspace(t, e.target.value))}>
            {workspaces.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </span>,
      )}
      {t.workspace.kind === "worktree" && (
        <p className="spexr-sched__hint">
          A new folder next to the repository, on branch <code className="spexr-sched__mono">spexr/{p.schedule.id}/{t.id}</code>,
          made from the project's last commit: uncommitted changes stay behind. It is kept after the run for you to review
          and merge.
          {t.harness === "claude" &&
            " Claude asks once whether to trust a new folder: the task shows Needs you until you choose “Yes” in its card. Its default answer ends the session."}
        </p>
      )}
```

After the `{field("Harness", …)}` call, insert:

```tsx
      {t.harness === "claude" &&
        field(
          "Account",
          "configDir",
          <span className="sl-select">
            <select className="sl-field__input" value={t.configDir ?? ""} onChange={(e) => p.onChange(withAccount(t, e.target.value))}>
              {accountOptions(p.configs, t.configDir).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>,
        )}
```

Replace the `{field("Prompt", …)}` call with:

```tsx
      {field(
        "Prompt",
        "prompt",
        <textarea
          ref={promptRef}
          className="sl-field__input spexr-sched__prompt"
          rows={5}
          value={t.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
        />,
      )}
      {handOffs.length > 0 ? (
        <div className="spexr-sched__handoff" role="group" aria-label="Insert a hand-off into the prompt">
          <span className="spexr-sched__hint">Insert:</span>
          {handOffs.map((h) => (
            <button key={h.token} type="button" className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => insertHandOff(h.token)} title={h.token}>
              {h.label}
            </button>
          ))}
        </div>
      ) : (
        <p className="spexr-sched__hint">Once this task waits for another, you can hand it that task's reply or folder.</p>
      )}
```

Directly before `<details className="spexr-sched__advanced">`, after Task 20's loop block, insert:

```tsx
      <fieldset className="spexr-sched__needs" data-invalid={problem("needs") ? "true" : undefined}>
        <legend className="sl-field__label">Waits for</legend>
        {needs.length === 0 ? (
          <p className="spexr-sched__hint">Add another task to make this one wait for it.</p>
        ) : (
          needs.map((n) => (
            <label key={n.id} className="sl-check">
              <input
                type="checkbox"
                className="sl-check__input"
                checked={n.checked}
                disabled={!!n.blockedBy}
                onChange={(e) => p.onChange(withNeed(t, n.id, e.target.checked))}
              />
              <span className="sl-check__box" aria-hidden="true" />
              <span className="sl-check__label">
                {n.name}
                {n.blockedBy && <span className="spexr-sched__hint"> — {n.blockedBy}</span>}
              </span>
            </label>
          ))
        )}
        {problem("needs") && <span className="spexr-sched__problem">{problem("needs")}</span>}
      </fieldset>
```

- [ ] **Step 4: Wire the wall widget**

In `darkfactory-wall-widget.tsx`, in `<ScheduleSidebar`, after the `projects={…}` prop, add `configs={this.configs}`.

- [ ] **Step 5: Styles**

In `src/browser/style/spexr.css`, change the selector `.spexr-sched__editor .sl-field[data-invalid="true"] .sl-field__input` to `.spexr-sched .sl-field[data-invalid="true"] .sl-field__input`, so the schedule name gets the same treatment. After the `.spexr-sched__mono` rule, add:

```css
/* "Waits for": one check per task; a choice that would close a cycle stays visible, disabled, with why. */
.spexr-sched__needs { display: flex; flex-direction: column; gap: var(--sl-space-2); margin: 0; padding: 0; border: 0; }
.spexr-sched__needs > legend { padding: 0; margin-bottom: var(--sl-space-1); }
/* Hand-offs insert at the caret; one button each, in the mono face of the tokens they insert. */
.spexr-sched__handoff { display: flex; flex-wrap: wrap; align-items: center; gap: var(--sl-space-1); }
.spexr-sched__handoff .sl-btn { font-family: var(--sl-font-mono); }
```

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/ && pnpm run lint && pnpm run typecheck`
Expected: PASS, clean.

```bash
git add src/browser/darkfactory/schedule/schedule-sidebar.tsx src/browser/darkfactory/darkfactory-wall-widget.tsx src/browser/style/spexr.css
git commit -m "feat(schedule): editor gains waits-for, workspace, hand-off and account pickers with inline problems"
```

### Task 31: Sidebar run view — bands, selection, Retry/Skip, Duplicate, safe Delete

**Files:**
- Modify: `src/browser/darkfactory/schedule/schedule-sidebar.tsx`
- Modify: `src/browser/darkfactory/darkfactory-wall-widget.tsx`
- Modify: `src/browser/style/spexr.css`

**Interfaces:**
- Consumes: `bandsOf`, `upstreamHighlight`, `duplicateSchedule`, `TaskRow.canRetry/workspace/session` (Task 29); `SpexrScheduleService.retry/skip` (Task 26).
- Produces: `ScheduleSidebarProps` gains `onRetry(scheduleId: string, taskId: string): Promise<ValidationProblem[]>` and `onSkip(scheduleId: string, taskId: string): Promise<ValidationProblem[]>`.

- [ ] **Step 1: Props, imports, state**

1. Change the `./schedule-view.js` import to also bring in `bandsOf`, `duplicateSchedule` and `upstreamHighlight`.
2. In `ScheduleSidebarProps`, after `onResume(…)`, add:

```ts
  /** Start a failed or interrupted task again; resolves to the problems that refused it. */
  onRetry(scheduleId: string, taskId: string): Promise<ValidationProblem[]>;
  /** Let its dependents start without it; resolves to the problems that refused it. */
  onSkip(scheduleId: string, taskId: string): Promise<ValidationProblem[]>;
```

3. After `const [confirmAbort, setConfirmAbort] = React.useState(false);`, add:

```ts
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  // The selected row: aria-current, its card focused while running, and its upstream highlighted.
  const [selected, setSelected] = React.useState<string | undefined>();
```

4. After `const rows = …;`, add `const upstream = schedule ? upstreamHighlight(schedule, selected) : new Set<string>();`.
5. After `addSchedule`, add:

```ts
  const duplicate = (): void => {
    if (!schedule) return;
    const copy = duplicateSchedule(schedule, new Set(p.snapshot.schedules.map((x) => x.id)));
    flush();
    clearTimeout(saveTimer.current);
    setDraft(undefined);
    savedRef.current = undefined;
    setRunProblems(undefined);
    p.onSave(copy);
    setSelectedId(copy.id);
  };
  /** Retry or Skip; a refusal joins the reasons above Run, like a refused run. */
  const taskAction = (act: (sid: string, tid: string) => Promise<ValidationProblem[]>, taskId: string): void => {
    if (!schedule) return;
    const scheduleId = schedule.id;
    void act(scheduleId, taskId).then((problems) => setRunProblems({ scheduleId, problems }));
  };
```

6. In the schedule `<select>`'s `onChange`, add `setSelected(undefined);` and `setConfirmDelete(false);` next to `setRunProblems(undefined);`.

- [ ] **Step 2: Duplicate and Delete with inline confirmation**

Replace the trash `<button …>…codicon-trash…</button>` with:

```tsx
            <button className="sl-icon-btn" onClick={duplicate} aria-label="Duplicate this schedule" title="Duplicate this schedule">
              <i className="codicon codicon-copy" />
            </button>
            {confirmDelete ? (
              <span className="spexr-sched__confirm" role="group" aria-label="Confirm delete">
                Delete “{schedule.name}”?
                <button
                  className="sl-btn sl-btn--sm"
                  onClick={() => {
                    setConfirmDelete(false);
                    removeSchedule(schedule.id);
                  }}
                >
                  Delete
                </button>
                <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button
                className="sl-icon-btn"
                onClick={() => setConfirmDelete(true)}
                disabled={running}
                aria-label="Delete this schedule"
                title="Delete this schedule"
              >
                <i className="codicon codicon-trash" />
              </button>
            )}
```

- [ ] **Step 3: The layered list**

Replace everything from `<ol className="spexr-sched__tasks">` through the closing `)}` of the `{!running && (<button … Add a task</button>)}` that follows it with:

```tsx
          {schedule.tasks.length === 0 ? (
            <div className="sl-empty spexr-sched__empty">
              <p>No tasks yet. A task is one agent session, with its own folder and prompt.</p>
              <button className="sl-btn sl-btn--sm" onClick={addTask}>
                <i className="codicon codicon-add" aria-hidden="true" /> Add a task
              </button>
            </div>
          ) : (
            <ol className="spexr-sched__bands" aria-label="Tasks, in the order they start">
              {bandsOf(rows).map((band) => (
                <li key={band.layer} className="spexr-sched__band">
                  <span className="sl-eyebrow">{band.layer === 0 ? "Starts first" : `Then, step ${band.layer + 1}`}</span>
                  <ol className="spexr-sched__tasks">
                    {band.rows.map((row) => (
                      <li
                        key={row.id}
                        className="spexr-sched__row"
                        data-layer={row.layer}
                        data-tone={row.tone}
                        data-upstream={upstream.has(row.id) ? "true" : undefined}
                        aria-current={selected === row.id ? "true" : undefined}
                      >
                        <button
                          className="spexr-sched__rowmain"
                          onClick={() => {
                            setSelected(row.id);
                            if (running) p.onFocusTask(schedule.id, row.id);
                            else setEditing(row.id);
                          }}
                        >
                          <span className="spexr-sched__name">{row.name}</span>
                          <span className="sl-tag sl-tag--plain">{row.harness}</span>
                          <span className="sl-tag sl-tag--plain">{row.workspace}</span>
                          <span
                            className={`sl-badge${row.tone !== "neutral" ? ` sl-badge--${row.tone}` : ""}${row.status === "running" ? " sl-badge--live" : ""}`}
                          >
                            <i className={`codicon ${row.icon}`} aria-hidden="true" /> {row.label}
                            {row.iteration ? ` · ${row.iteration}` : ""}
                          </span>
                          {upstream.has(row.id) && (
                            <span className="sl-tag">
                              <i className="codicon codicon-arrow-up" aria-hidden="true" /> Upstream
                            </span>
                          )}
                          {row.unattended && (
                            <span className="sl-badge sl-badge--warning" title="Tools run without asking">
                              <i className="codicon codicon-warning" aria-hidden="true" /> Unattended
                            </span>
                          )}
                          {row.waitsFor.length > 0 && <span className="spexr-sched__waits">after {row.waitsFor.join(", ")}</span>}
                          {row.session && <span className="spexr-sched__waits spexr-sched__mono">session {row.session}</span>}
                          {row.error && <span className="spexr-sched__error">{row.error}</span>}
                        </button>
                        <span className="spexr-sched__rowactions">
                          {row.canRetry && (
                            <>
                              <button
                                className="sl-btn sl-btn--sm"
                                onClick={() => taskAction(p.onRetry, row.id)}
                                title="Start it again from iteration 1 in the same workspace. Its failed session is closed."
                              >
                                <i className="codicon codicon-debug-restart" aria-hidden="true" /> Retry
                              </button>
                              <button
                                className="sl-btn sl-btn--ghost sl-btn--sm"
                                onClick={() => taskAction(p.onSkip, row.id)}
                                title="Let the tasks that wait for it start without it. Its hand-offs arrive empty; its session stays open."
                              >
                                <i className="codicon codicon-debug-step-over" aria-hidden="true" /> Skip
                              </button>
                            </>
                          )}
                          {!running && (
                            <button
                              className="sl-icon-btn"
                              onClick={() => setEditing(editing === row.id ? undefined : row.id)}
                              aria-label={`Edit ${row.name}`}
                              aria-expanded={editing === row.id}
                            >
                              <i className="codicon codicon-edit" />
                            </button>
                          )}
                        </span>
                        {editing === row.id && !running && (
                          <TaskEditor
                            task={schedule.tasks.find((t) => t.id === row.id)!}
                            schedule={schedule}
                            projects={p.projects}
                            configs={p.configs}
                            problems={problems.filter((x) => x.task === row.id)}
                            onChange={updateTask}
                            onBlur={flush}
                          />
                        )}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}
          {!running && schedule.tasks.length > 0 && (
            <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={addTask}>
              <i className="codicon codicon-add" aria-hidden="true" /> Add a task
            </button>
          )}
```

- [ ] **Step 4: Wire the wall widget**

In `darkfactory-wall-widget.tsx`:

1. After `runSchedule`, add:

```ts
  /**
   * Retry a task with its launch resolved again here (R22): the preferences
   * or the active profile may have changed since Run.
   */
  private async retryTask(scheduleId: string, taskId: string): Promise<ValidationProblem[]> {
    const task = this.scheduleSnapshot.schedules.find((s) => s.id === scheduleId)?.tasks.find((t) => t.id === taskId);
    if (!task) return [{ field: "run", message: "Unknown task." }];
    const launch = this.terminals.resolveLaunch(task.harness, task.configDir ?? "", task.project);
    const problems = await this.schedules.retry(scheduleId, taskId, launch);
    this.refreshSchedules();
    return problems;
  }
```

2. In `runSchedule`'s doc comment, change "a task with no usable launch command, a worktree workspace (Slice 4), or a run already in progress" to "a task with no usable launch command, or a run already in progress".
3. In `<ScheduleSidebar`, after `onResume={…}`, add:

```tsx
              onRetry={(sid, tid) =>
                this.retryTask(sid, tid).catch((): ValidationProblem[] => [{ field: "run", message: "Could not retry the task." }])
              }
              onSkip={(sid, tid) =>
                this.schedules.skip(sid, tid).then(
                  (problems) => {
                    this.refreshSchedules();
                    return problems;
                  },
                  (): ValidationProblem[] => [{ field: "run", message: "Could not skip the task." }],
                )
              }
```

- [ ] **Step 5: Styles**

In `src/browser/style/spexr.css`, replace the comment `/* Layers read as bands: … */`, the `.spexr-sched__row { … padding-left: … }` rule and the three `.spexr-sched__row[data-layer="…"]` rules with:

```css
.spexr-sched__row { display: grid; grid-template-columns: 1fr auto; gap: var(--sl-space-2); }
/* The layered list: each depth is a band with its own label, and starts only once the bands above it have settled. */
.spexr-sched__bands { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--sl-space-3); }
.spexr-sched__band { display: flex; flex-direction: column; gap: var(--sl-space-2); padding-left: var(--sl-space-3); border-left: 2px solid var(--sl-border-subtle); }
.spexr-sched__rowactions { display: flex; align-items: flex-start; gap: var(--sl-space-1); }
/* Upstream of the selected task: a dashed accent border and an "Upstream" tag — never colour alone. */
.spexr-sched__row[data-upstream="true"] .spexr-sched__rowmain { border-style: dashed; border-color: var(--sl-accent-default); }
```

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run --maxWorkers=2 src/browser/darkfactory/ && pnpm run lint && pnpm run typecheck`
Expected: PASS, clean.

```bash
git add src/browser/darkfactory/schedule/schedule-sidebar.tsx src/browser/darkfactory/darkfactory-wall-widget.tsx src/browser/style/spexr.css
git commit -m "feat(schedule): layered bands, row selection with upstream highlight, Retry/Skip, Duplicate, confirmed Delete (AC-15, AC-17)"
```

### Task 32: Look-and-feel pass and the manual check (AC-12..AC-17)

**Files:**
- Modify only when a check below fails: the sidebar files from Tasks 30–31. Any logic fix goes into a `.ts` module with a failing test first, one `fix(schedule): …` commit per fix.

**Interfaces:** none new.

- [ ] **Step 1: Mechanical checks**

Run, in `packages/theia-extensions`:

```bash
sed -n '/^\.spexr-sched {/,/^\.spexr-df-launcher {/p' src/browser/style/spexr.css | grep -nE "#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(" || echo "no raw colours"
grep -c "sl-btn--primary" src/browser/darkfactory/schedule/schedule-sidebar.tsx
grep -n "sl-fx" src/browser/darkfactory/schedule/schedule-sidebar.tsx || echo "no decorative effects"
```

Expected:
- `no raw colours`: every value is a `--sl-*` token.
- `1`: Run is the only primary button.
- `no decorative effects`: under `power-save` nothing in the sidebar has to stand still. The live badge is status, and keeps running like the wall's cards.

- [ ] **Step 2: Manual check in the app**

Rebuild, then quit any running SPEXR first (`docs/memory/electron-single-instance-lock.md`). Use a scratch repository with one commit, e.g. `~/tmp/sched-demo`.

1. **Graph and worktrees (AC-12, AC-13, AC-14).** Build this schedule:
   - A: worktree, claude, "Create api.md with one line."
   - B: worktree, waits for A, "Read this and create web.md: {{a.reply}}".
   - C: worktree, waits for A.
   - D: same as B, waits for B and C, "List the files in {{c.workspace}}."

   Run it. A shows *Needs you* on the trust dialog; choose "Yes" in its card. When A converges, B and C start together. D starts only after both, in B's worktree folder, with C's folder in its prompt. Afterwards `git -C ~/tmp/sched-demo worktree list` shows three worktrees on `spexr/<schedule>/{a,b,c}`, and they are still there.
2. **Failure, Retry, Skip (AC-15).**
   - Type `/exit` into B's card. The run bar reads "Paused on a failure". C still finishes, and D does not start.
   - Press Retry on B. Its old card's session ends, and a new card opens in the same worktree folder, with the work left there and no trust dialog this time.
   - Make C fail, then press Skip. D starts, and `{{c.workspace}}` arrives empty.
   - Pause and Resume while two tasks work: nothing new starts until Resume.
   - The retried session shows in its **new** card, not in the failed attempt's card. Risk: a failed attempt's card that the wall never adopted (for example, it failed at the trust dialog before any transcript existed) is still in `launched` with the same `projectPath`. `matchLaunchedSession` could then hand it the retried session. If that happens, record it on the PR and fix it in its own commit: add the retried session to the old card's `knownBefore`, or drop the old card when its task is retried.
3. **Rerun (R15).** Press Run again once the run is over. A fails with "left from an earlier run" and the cleanup commands. Press Retry on A: it continues on the old worktree.
4. **Restart (AC-16).** Quit SPEXR mid-run and start it again. The run comes back paused, its active tasks *Interrupted*. Retry one: `ps` shows that no other process was killed. Skip another.
5. **Editor.**
   - A "waits for" choice that would close a cycle is disabled, with the reason next to it.
   - Workspace offers "Same as" only for upstream tasks, and the hand-off buttons list only upstream tasks.
   - A hand-off inserts at the caret.
   - The account picker lists the launcher's accounts.
   - Problems show next to their field as you type: clear a prompt; pick "Same as B", then untick B.
6. **Look and feel (AC-17), in the light and the dark theme, and keyboard only.**
   - Tab reaches, with a visible focus ring each time: the picker, New, Duplicate, Delete (then Keep or Delete), Run/Pause/Abort, every row, Retry, Skip, Edit, every editor control, each "waits for" check and each hand-off button.
   - Selecting a row sets `aria-current` and tags its upstream rows "Upstream".
   - VoiceOver announces task state changes through the polite live region.
   - With reduced motion on, nothing unfolds. With power-save on, nothing decorative moves.
   - With no schedule, and with a schedule that has no tasks, the pane shows an `sl-empty` with one sentence and one action.

Record what you saw on the PR, one line per numbered item. Anything that fails gets its own fix commit, per the Files note above.

- [ ] **Step 3: Verify the branch**

Run: `npx vitest run --maxWorkers=2 src/common/schedule/ src/node/schedule/ src/browser/darkfactory/ && pnpm run lint && pnpm run typecheck`
Expected: PASS, clean.

**Slice 4 ends here.** Push to https://github.com/sondalab-ai/spexr-ide/pull/66, tick the slice, and mark the PR ready for review only after the final whole-branch review.
