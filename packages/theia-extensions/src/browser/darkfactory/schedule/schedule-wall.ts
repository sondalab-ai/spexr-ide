import type { HarnessId } from "../../../common/harness/harness-types.js";
import type { ScheduleSnapshot } from "../../../common/schedule/schedule-protocol.js";
import { ACTIVE_STATUSES } from "../../../common/schedule/schedule-types.js";
import { matchLaunchedSession, type MatchableTile } from "../new-session-match.js";

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

/**
 * Whether closing a launched card should end its terminal's process. A task
 * card (its key tracked in `taskKeys`) is scheduler-owned — the schedule spec
 * ends a run only on Abort, so closing the card must only detach it, leaving
 * the run's terminal live. Any other launched card's terminal is the card's
 * only handle to that process, so it is disposed with the card, as before.
 */
export function closesDestructively(key: string, taskKeys: ReadonlySet<string>): boolean {
  return !taskKeys.has(key);
}

/**
 * Card keys of the task terminals still running an active task, each with the
 * session it runs when known. A launched task card missing here was superseded
 * (a retry gives its task a new terminal) or its task or run is over, so the
 * wall drops it rather than let it adopt the session of the attempt after it.
 */
export function liveTaskCards(snapshot: ScheduleSnapshot): Map<string, string | undefined> {
  const live = new Map<string, string | undefined>();
  for (const schedule of snapshot.schedules) {
    const run = snapshot.runs[schedule.id];
    if (!run || run.status !== "running") continue;
    for (const task of schedule.tasks) {
      const t = run.tasks[task.id];
      if (!t || !ACTIVE_STATUSES.has(t.status) || t.terminalId === undefined) continue;
      live.set(`spexr-task-${t.terminalId}`, t.sessionId);
    }
  }
  return live;
}

export interface AdoptableCard {
  projectPath: string;
  knownBefore: ReadonlySet<string>;
  /** The session the card is known to run (a Claude task from its launch); adopted by exact id only. */
  sessionId?: string;
}

/**
 * The session a launched card adopts from a scan, or undefined. A card that
 * knows its session takes exactly that one; any other falls back to the first
 * new session in its folder, never one that another launched card claims.
 */
export function adoptedSession(
  card: AdoptableCard,
  launched: readonly AdoptableCard[],
  tiles: readonly MatchableTile[],
): string | undefined {
  if (card.sessionId !== undefined) return tiles.some((t) => t.sessionId === card.sessionId) ? card.sessionId : undefined;
  const excluded = new Set(card.knownBefore);
  for (const other of launched) if (other !== card && other.sessionId !== undefined) excluded.add(other.sessionId);
  return matchLaunchedSession(card.projectPath, excluded, tiles);
}
