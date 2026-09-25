/**
 * `fn`, answered from its last result until `ttlMs` has passed on `now`.
 * Concurrent callers share one in-flight call; a rejection is not kept, so
 * the next call retries.
 */
export function memoizeFor<T>(ttlMs: number, now: () => number, fn: () => Promise<T>): () => Promise<T> {
  let last: { at: number; value: Promise<T> } | undefined;
  return () => {
    const t = now();
    if (last && t - last.at < ttlMs) return last.value;
    const value = fn();
    const entry = { at: t, value };
    last = entry;
    value.catch(() => {
      if (last === entry) last = undefined;
    });
    return value;
  };
}
