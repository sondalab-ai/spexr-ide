import type { AgentTile } from "../../common/darkfactory-protocol.js";

/** Storage key for the pinned cards, so they survive a window reload. */
export const PINS_KEY = "spexr.darkfactory.pins";

/** The backend terminal a card was showing, and the OS process that ran in it. */
export interface StoredTerminal {
  readonly terminalId: number;
  /**
   * Terminal ids restart from 1 when the backend restarts, so an id alone could
   * point at somebody else's terminal; the process id says whether it is ours.
   */
  readonly processId: number;
}

/**
 * One pinned card: the last tile seen for its session, which keeps it on the
 * wall until a scan returns it, and its terminal when it had one.
 */
export interface StoredPin {
  readonly tile: AgentTile;
  readonly terminal?: StoredTerminal;
}

/** The slice of `localStorage` this module needs, so tests can pass a fake. */
export interface PinStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isTerminal(t: unknown): t is StoredTerminal {
  const { terminalId, processId } = (t ?? {}) as Partial<StoredTerminal>;
  return (
    typeof terminalId === "number" && terminalId >= 0 && typeof processId === "number" && processId > 0
  );
}

/** The stored pins, newest first; empty whenever nothing usable is stored. */
export function readPins(storage: PinStorage): StoredPin[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(PINS_KEY) ?? "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const pins: StoredPin[] = [];
  for (const entry of parsed) {
    const { tile, terminal } = (entry ?? {}) as { tile?: AgentTile; terminal?: unknown };
    if (typeof tile?.sessionId !== "string" || typeof tile.projectPath !== "string") continue;
    pins.push(isTerminal(terminal) ? { tile, terminal } : { tile });
  }
  return pins;
}

/** Persist the pins. Storage failures are ignored: the cards still work for this window. */
export function writePins(storage: PinStorage, pins: readonly StoredPin[]): void {
  try {
    storage.setItem(PINS_KEY, JSON.stringify(pins));
  } catch {
    // ignore
  }
}
