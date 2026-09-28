import type { ScheduleTask } from "./schedule-types.js";

/**
 * Harness arguments for a task's first launch; the prompt is always last.
 * A filled hand-off can make the prompt start with "-", which the harness would
 * parse as an option, so such a prompt gets one leading space.
 */
export function buildTaskArgs(task: ScheduleTask, rawPrompt: string, sessionId?: string): string[] {
  const prompt = rawPrompt.startsWith("-") ? ` ${rawPrompt}` : rawPrompt;
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
