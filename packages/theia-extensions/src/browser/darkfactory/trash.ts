import type { AgentTile } from "../../common/darkfactory-protocol.js";

/** Storage key for the sessions the user has moved to the trash. */
export const TRASH_KEY = "spexr.darkfactory.trashed";

/**
 * How many trashed session ids are remembered. The set is deliberately NOT
 * pruned against the sessions currently on the wall: the scan only surfaces the
 * newest sessions, so a trashed one slides off and would come back untrashed the
 * next time it re-enters that window. The cap is what bounds the list instead —
 * oldest entries are evicted first.
 */
export const TRASH_CAP = 200;

/** The slice of `localStorage` this module needs, so tests can pass a fake. */
export interface TrashStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored session ids, oldest first; empty whenever nothing usable is stored. */
export function readTrashed(storage: TrashStorage): string[] {
  let raw: string | null;
  try {
    raw = storage.getItem(TRASH_KEY);
  } catch {
    return []; // private windows and blocked site data throw on access
  }
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id): id is string => typeof id === "string" && id.length > 0).slice(-TRASH_CAP);
}

/** Persist the trashed ids, newest last. Storage failures are ignored: the wall still hides them. */
export function writeTrashed(storage: TrashStorage, ids: readonly string[]): void {
  try {
    storage.setItem(TRASH_KEY, JSON.stringify(ids.slice(-TRASH_CAP)));
  } catch {
    // ignore
  }
}

/** Add a session to the trash, keeping insertion order and the cap. */
export function addTrashed(ids: readonly string[], sessionId: string): string[] {
  return [...ids.filter((id) => id !== sessionId), sessionId].slice(-TRASH_CAP);
}

/** Take a session back out of the trash. */
export function removeTrashed(ids: readonly string[], sessionId: string): string[] {
  return ids.filter((id) => id !== sessionId);
}

/**
 * Split the wall's tiles into the ones still worth showing and the trashed ones.
 * Both keep the order they came in, so the caller's sort survives.
 */
export function partitionTrashed(
  tiles: readonly AgentTile[],
  trashed: ReadonlySet<string>,
): { kept: AgentTile[]; discarded: AgentTile[] } {
  const kept: AgentTile[] = [];
  const discarded: AgentTile[] = [];
  for (const tile of tiles) {
    if (trashed.has(tile.sessionId)) discarded.push(tile);
    else kept.push(tile);
  }
  return { kept, discarded };
}
