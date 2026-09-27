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
