import type { HarnessId } from "../../../common/harness/harness-types.js";
import {
  RETRYABLE_STATUSES,
  UNATTENDED_MODES,
  type RunState,
  type Schedule,
  type ScheduleTask,
  type TaskStatus,
  type ValidationProblem,
} from "../../../common/schedule/schedule-types.js";
import { findCycle, layersOf, upstreamOf } from "../../../common/schedule/schedule-graph.js";

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
  /** Where it works: "Project folder", "Worktree" or "Same as <task>". */
  workspace: string;
  status: TaskStatus;
  label: string;
  icon: string;
  tone: Tone;
  iteration?: string;
  unattended: boolean;
  /** Failed or interrupted in a running run: Retry and Skip apply (R21). */
  canRetry: boolean;
  /** The opencode session the runner adopted, shown so a wrong pick-up is visible (spec, Risks). */
  session?: string;
  error?: string;
}

/**
 * Rows in layer order (depth first, then schedule order), with their run
 * state when there is a run. A cyclic schedule has no layers — `layersOf`
 * would have no base case to recurse from — so a cycle falls back to a flat
 * list at layer 0, in schedule order; `validateSchedule` is what actually
 * rejects the cycle, this just keeps the sidebar rendering rather than
 * hanging the whole Dark Factory on a bad save.
 */
export function taskRows(schedule: Schedule, run?: RunState): TaskRow[] {
  const byId = new Map(schedule.tasks.map((t) => [t.id, t]));
  const cyclic = findCycle(schedule) !== undefined;
  const order: [id: string, layer: number][] = cyclic
    ? schedule.tasks.map((t): [string, number] => [t.id, 0])
    : layersOf(schedule).flatMap((ids, layer) => ids.map((id): [string, number] => [id, layer]));
  const live = run?.status === "running";
  return order.map(([id, layer]) => {
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
      workspace: workspaceLabel(t, byId),
      status,
      ...STATUS_VIEW[status],
      ...(state && max && state.iteration > 0 ? { iteration: `${state.iteration} / ${max}` } : {}),
      unattended: !!t.permissionMode && UNATTENDED_MODES[t.harness].includes(t.permissionMode),
      canRetry: live && RETRYABLE_STATUSES.has(status),
      ...(t.harness === "opencode" && state?.sessionId ? { session: state.sessionId } : {}),
      ...(state?.error ? { error: state.error } : {}),
    };
  });
}

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

/**
 * One "<task>: <label>" line per task whose status changed between two
 * `taskRows()` calls, in row order — for a screen-reader announcement.
 * `undefined` `prev` (nothing rendered yet) announces nothing, so mounting
 * the sidebar doesn't read out every task's initial state.
 */
export function taskTransitions(prev: readonly TaskRow[] | undefined, next: readonly TaskRow[]): string[] {
  if (!prev) return [];
  const prevStatus = new Map(prev.map((r) => [r.id, r.status]));
  return next
    .filter((r) => prevStatus.has(r.id) && prevStatus.get(r.id) !== r.status)
    .map((r) => `${r.name}: ${r.label}`);
}

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
