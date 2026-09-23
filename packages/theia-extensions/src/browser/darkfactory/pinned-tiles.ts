import type { AgentTile } from "../../common/darkfactory-protocol.js";

/**
 * The tiles to show after a scan: the scan's own, plus the last-seen tile of
 * every pinned session the scan left out. A scan omitting a session is not a
 * sign it ended — the backend only reads the most recent transcripts, and an
 * idle pinned session drops past that cut as soon as enough others are written
 * after it; a directory can also be briefly unreadable. Only the user closes a
 * pinned card.
 */
export function keepPinnedTiles(
  fresh: AgentTile[],
  previous: readonly AgentTile[],
  pinned: readonly string[],
): AgentTile[] {
  const seen = new Set(fresh.map((t) => t.sessionId));
  const carried = previous.filter((t) => pinned.includes(t.sessionId) && !seen.has(t.sessionId));
  return carried.length ? [...fresh, ...carried] : fresh;
}
