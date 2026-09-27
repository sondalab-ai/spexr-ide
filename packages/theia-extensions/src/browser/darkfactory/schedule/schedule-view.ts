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
