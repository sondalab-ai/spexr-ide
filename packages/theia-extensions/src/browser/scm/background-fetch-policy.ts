/**
 * How often the IDE fetches on its own. Long enough that a workspace of several
 * repositories is not talking to its remotes constantly, short enough that
 * "behind by N" is worth reading.
 */
export const BACKGROUND_FETCH_INTERVAL_MS = 3 * 60_000;

/**
 * Whether a background fetch should start now. Two triggers share this — the
 * timer and the window regaining focus — and without a floor between them,
 * alt-tabbing would fetch on every switch.
 */
export function shouldFetchNow(
  lastFetchAt: number | undefined,
  now: number,
  intervalMs: number = BACKGROUND_FETCH_INTERVAL_MS,
): boolean {
  if (lastFetchAt === undefined) return true;
  return now - lastFetchAt >= intervalMs;
}
