/**
 * HEAD's sha per repository, read through `read` (a `git log -1`): callers
 * within `ttlMs` of a read share its promise, so many editors refreshing after
 * one status event cost one process, while a later refresh reads again, since
 * a HEAD move with an unchanged status raises no event (S6c, E7). `clear` (a
 * status event) forgets what is held, and a read started before it is not
 * kept. Free of Theia, so it is tested in plain node.
 */
export class HeadShaCache {
  private readonly entries = new Map<string, { promise: Promise<string>; at: number }>();

  constructor(
    private readonly read: (root: string) => Promise<string>,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = 300,
  ) {}

  /** HEAD's sha in `root`: the read in flight or just done, or a new one. */
  get(root: string): Promise<string> {
    const held = this.entries.get(root);
    if (held && this.now() - held.at < this.ttlMs) return held.promise;
    const entry = { promise: this.read(root), at: this.now() };
    this.entries.set(root, entry);
    return entry.promise;
  }

  /** Forget every sha: the next `get` reads again, and a read still running is no longer held. */
  clear(): void {
    this.entries.clear();
  }
}
