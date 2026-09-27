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
