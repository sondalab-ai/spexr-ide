import type { ScheduleSnapshot } from "../../common/schedule/schedule-protocol.js";

/** Scheduled tasks whose runs are going on: a run still running with a task in an active status. */
export function runningScheduledTasks(snapshot: ScheduleSnapshot): number {
  let n = 0;
  for (const run of Object.values(snapshot.runs)) {
    if (run.status !== "running") continue;
    for (const t of Object.values(run.tasks)) if (["starting", "running", "waiting-on-you", "checking", "held"].includes(t.status)) n++;
  }
  return n;
}

/**
 * What to tell the user when the workspace stops being trusted while agents
 * work, or undefined when nothing is running. Nothing is killed: a running
 * session keeps going, so the person is told what is still acting without the
 * trust they gave (and that new sessions will not start). Note the Dark
 * Factory gate asks about this window's workspace trust, not the trust of
 * the project a session belongs to.
 */
export function trustRevokedMessage(running: { readonly agent: boolean; readonly scheduledTasks: number }): string | undefined {
  const parts: string[] = [];
  if (running.agent) parts.push("the agent");
  if (running.scheduledTasks > 0) parts.push(`${running.scheduledTasks} scheduled ${running.scheduledTasks === 1 ? "task" : "tasks"}`);
  if (parts.length === 0) return undefined;
  return `This workspace is no longer trusted, but ${parts.join(" and ")} ${running.agent && running.scheduledTasks > 0 ? "are" : running.agent || running.scheduledTasks === 1 ? "is" : "are"} still running. Nothing was stopped; no new session will start.`;
}
