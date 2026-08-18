/**
 * Memoize a zero-arg async loader so its work (a disk read, a subprocess spawn)
 * runs at most once per instance. The Darkfactory tile pipeline calls a ref's
 * `loadEntries` from both `parseTranscript` and the entry consumers on the same
 * scan; without this the transcript would be read — or `opencode export` spawned
 * — twice per session per tick.
 */
export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= fn());
}
