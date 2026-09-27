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
