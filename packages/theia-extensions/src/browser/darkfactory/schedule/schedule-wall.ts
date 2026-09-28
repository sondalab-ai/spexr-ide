import type { HarnessId } from "../../../common/harness/harness-types.js";
import type { ScheduleSnapshot } from "../../../common/schedule/schedule-protocol.js";
import { ACTIVE_STATUSES } from "../../../common/schedule/schedule-types.js";
import { matchLaunchedSession, type MatchableTile } from "../new-session-match.js";

export interface TaskCard {
  key: string;
  /** The run the card was mounted for; a new run replaces it even on a reused terminal id. */
  runId: string;
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
      cards.push({
        key,
        runId: run.runId,
        terminalId: t.terminalId,
        processId: t.processId,
        workspace: t.workspace,
        harness: task.harness,
        ...(t.sessionId ? { sessionId: t.sessionId } : {}),
      });
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
 * Card keys of the task terminals still running an active task in a running
 * run, each with the session it runs when known: the cards the wall mounts
 * ({@link taskCardsToMount} applies the same filter). Whether a mounted card
 * stays is {@link currentTaskCards}'s call, not this.
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

/** A task terminal of a schedule's current run: the run's id and the task's session when known. */
export interface CurrentTaskCard {
  runId: string;
  sessionId?: string;
}

/**
 * Card keys of every task terminal in each schedule's current run, whatever
 * the task or run status. A key can list several runs: terminal ids start
 * over when the backend restarts, so an older run of another schedule may
 * name the same terminal id. A task card stays on the wall while its key
 * lists the run it was mounted for: a failed, converged or aborted task's
 * session is still open for the operator. It goes once a retry gives the
 * task a new terminal, a new run replaces the run, recovery clears the
 * terminal, or the schedule is deleted.
 */
export function currentTaskCards(snapshot: ScheduleSnapshot): Map<string, CurrentTaskCard[]> {
  const current = new Map<string, CurrentTaskCard[]>();
  for (const schedule of snapshot.schedules) {
    const run = snapshot.runs[schedule.id];
    if (!run) continue;
    for (const task of schedule.tasks) {
      const t = run.tasks[task.id];
      if (t?.terminalId === undefined) continue;
      const key = `spexr-task-${t.terminalId}`;
      const entry = { runId: run.runId, ...(t.sessionId !== undefined ? { sessionId: t.sessionId } : {}) };
      current.set(key, [...(current.get(key) ?? []), entry]);
    }
  }
  return current;
}

/** The current-run entry of the task card `key` mounted for `runId`, or undefined once it is no longer part of that run. */
export function currentTaskCard(
  current: ReadonlyMap<string, readonly CurrentTaskCard[]>,
  key: string,
  runId: string | undefined,
): CurrentTaskCard | undefined {
  return current.get(key)?.find((c) => c.runId === runId);
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

/**
 * Bring launched cards in step with the runs. Only task cards (keys in
 * `taskKeys`) are judged: one no longer part of its current run
 * ({@link currentTaskCard}) is dropped — the caller detaches it, never
 * disposes it, and frees its key for a later remount; a kept one learns its
 * task's session id once the engine has it. Launcher cards pass through.
 */
export function syncLaunchedTasks<T extends { key: string; runId?: string; sessionId?: string }>(
  launched: readonly T[],
  taskKeys: ReadonlySet<string>,
  current: ReadonlyMap<string, readonly CurrentTaskCard[]>,
): { kept: T[]; dropped: string[] } {
  const kept: T[] = [];
  const dropped: string[] = [];
  for (const l of launched) {
    if (!taskKeys.has(l.key)) {
      kept.push(l);
      continue;
    }
    const entry = currentTaskCard(current, l.key, l.runId);
    if (!entry) dropped.push(l.key);
    else {
      const sessionId = entry.sessionId;
      kept.push(sessionId !== undefined && sessionId !== l.sessionId ? { ...l, sessionId } : l);
    }
  }
  return { kept, dropped };
}
