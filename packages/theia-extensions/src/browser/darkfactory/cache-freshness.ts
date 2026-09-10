import type { AgentTile } from "../../common/darkfactory-protocol.js";

/**
 * How long before the deadline a session starts asking to be resumed. Ten
 * minutes is wide enough to absorb the two ways the deadline runs optimistic —
 * the anchor is when the last model call finished rather than when it started,
 * and the wall only re-renders on the backend's 20-second push — while staying
 * short enough that the chip means "now", not "sometime today".
 */
export const EXPIRING_WINDOW_MS = 10 * 60 * 1000;

/** Where a session sits relative to its prompt cache's expected lifetime. */
export type CacheKind = "warm" | "expiring" | "cold";

export interface CacheFreshness {
  kind: CacheKind;
  /** Time left before the cache is expected to expire; 0 once it is cold. */
  remainingMs: number;
}

/**
 * Read a session's cache state at `now`. Undefined for a session that never
 * reported usage — no data is not the same as a cold cache, and the wall says
 * nothing rather than guessing.
 */
export function cacheFreshness(tile: AgentTile, now: number): CacheFreshness | undefined {
  const deadline = tile.cacheDeadlineMs;
  if (deadline === undefined) return undefined;
  const remainingMs = deadline - now;
  if (remainingMs <= 0) return { kind: "cold", remainingMs: 0 };
  return { kind: remainingMs <= EXPIRING_WINDOW_MS ? "expiring" : "warm", remainingMs };
}

/** The sessions worth interrupting the user for — the banner and its filter share this. */
export function expiringTiles(tiles: AgentTile[], now: number): AgentTile[] {
  return tiles.filter((t) => cacheFreshness(t, now)?.kind === "expiring");
}

/** Minutes left, rounded up, never "0m" while the cache is still alive. */
export function expiryLabel(remainingMs: number): string {
  return `${Math.max(1, Math.ceil(remainingMs / 60_000))}m`;
}

/** Token count at reading size: 512, 21K, 1.2M. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return `${Math.round(tokens)}`;
  if (tokens < 1_000_000) return `${Math.round(tokens / 1000)}K`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}
