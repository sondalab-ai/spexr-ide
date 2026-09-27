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
