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
