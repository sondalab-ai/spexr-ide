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
