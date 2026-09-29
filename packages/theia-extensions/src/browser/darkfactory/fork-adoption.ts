import { matchLaunchedSession, type MatchableTile } from "./new-session-match.js";

/**
 * A card whose session was forked in place ("Fork & continue"). The fork runs
 * under a new session id the harness only reveals by writing its transcript,
 * so the card keeps the original id until a scan shows the new session.
 */
export interface PendingFork {
  readonly fromId: string;
  readonly projectPath: string;
  /** Every session id the wall knew when the fork started. */
  readonly knownBefore: ReadonlySet<string>;
}

/**
 * Which forked cards can now move to the session their fork wrote, recognised
 * the same way a launched session is: the newest session that appeared in that
 * project after the fork. A fork whose card was closed is dropped; one with no
 * new session yet, or whose new session already has a card, stays pending.
 */
export function resolveForks(
  forks: readonly PendingFork[],
  pinned: readonly string[],
  tiles: readonly MatchableTile[],
): { adopted: { fromId: string; toId: string }[]; pending: PendingFork[] } {
  const adopted: { fromId: string; toId: string }[] = [];
  const pending: PendingFork[] = [];
  for (const fork of forks) {
    if (!pinned.includes(fork.fromId)) continue;
    const toId = matchLaunchedSession(fork.projectPath, fork.knownBefore, tiles);
    if (toId && !pinned.includes(toId)) adopted.push({ fromId: fork.fromId, toId });
    else pending.push(fork);
  }
  return { adopted, pending };
}

/**
 * Cards open on a session a newer resume copy has taken over, and the session
 * each moves to. The copy is where the conversation continues — whether it was
 * resumed from this card or from a terminal elsewhere — and the scan no longer
 * returns the old one. A card already open on the copy leaves the old card be.
 */
export function resolveSuccessors(
  pinned: readonly string[],
  tiles: readonly { sessionId: string; supersedes?: readonly string[] }[],
): { fromId: string; toId: string }[] {
  const moves: { fromId: string; toId: string }[] = [];
  for (const tile of tiles) {
    if (!tile.supersedes || pinned.includes(tile.sessionId)) continue;
    const fromId = tile.supersedes.find((id) => pinned.includes(id));
    if (fromId) moves.push({ fromId, toId: tile.sessionId });
  }
  return moves;
}

/**
 * Pins stored before a window reload, pointed at the sessions their cards just
 * moved to, so the restore re-attaches each terminal under the card's new id
 * instead of skipping a pin whose id is no longer open.
 */
export function retargetPins<P extends { tile: { sessionId: string } }>(
  stored: readonly P[],
  moves: readonly { fromId: string; toId: string }[],
  tiles: readonly P["tile"][],
): P[] {
  return stored.map((pin) => {
    const move = moves.find((m) => m.fromId === pin.tile.sessionId);
    const tile = move && tiles.find((t) => t.sessionId === move.toId);
    return tile ? { ...pin, tile } : pin;
  });
}
