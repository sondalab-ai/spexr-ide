/** The little a launched-session match needs to know about a tile. */
export interface MatchableTile {
  readonly sessionId: string;
  readonly projectPath: string;
  readonly lastActivityMs: number;
}

/**
 * The session id a freshly launched harness produced. A new session has no id
 * until the harness writes its transcript, so the card that started it is keyed
 * by a placeholder; this recognises the real session as the one that appeared in
 * that project after the launch, taking the most recently active when several
 * did. Returns undefined while nothing new has shown up yet.
 */
export function matchLaunchedSession(
  projectPath: string,
  knownBefore: ReadonlySet<string>,
  tiles: readonly MatchableTile[],
): string | undefined {
  let best: MatchableTile | undefined;
  for (const tile of tiles) {
    if (tile.projectPath !== projectPath) continue;
    if (knownBefore.has(tile.sessionId)) continue;
    if (!best || tile.lastActivityMs > best.lastActivityMs) best = tile;
  }
  return best?.sessionId;
}
