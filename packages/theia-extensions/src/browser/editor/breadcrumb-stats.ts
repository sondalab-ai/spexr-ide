import type { DiffStats } from "./breadcrumb-model.js";
import { isNotInHead, repoRootFor } from "./diff-budget.js";

/** What the stats read from the outside: the repositories, their state and HEAD's text. */
export interface StatsDeps {
  /** The roots of the workspace's repositories (file-system paths). */
  roots(): readonly string[];
  /** The repository's head signature for a file (`headSignature`). */
  signature(root: string, relPath: string): string;
  /** HEAD's text of a file; rejects with git's message when it is not there. */
  readHead(root: string, relPath: string): Promise<string>;
  /** The stat for the two texts, or undefined over the budget (`diffStats`). */
  diff(previous: string, current: string): DiffStats | undefined;
}

/**
 * The lines each open file differs from HEAD by (S6c, E7), with the costs
 * kept down: HEAD's text is cached per file until the repository's head
 * signature changes, and each refresh carries a sequence number so an answer
 * that was overtaken by a newer one is dropped. Free of Theia, so the cache
 * and the staleness are tested apart from it.
 */
export class BreadcrumbStats {
  private readonly cache = new Map<string, { signature: string; head: string }>();
  private readonly sequence = new Map<string, number>();
  private readonly values = new Map<string, DiffStats | undefined>();

  constructor(private readonly deps: StatsDeps) {}

  /** The last stat for a file; undefined when it is unknown, outside a repository, over budget or failed. */
  get(uri: string): DiffStats | undefined {
    return this.values.get(uri);
  }

  /**
   * Read the stat of `text` against HEAD. Resolves to whether the stored stat
   * changed; false too when a newer refresh of the same file started meanwhile.
   * A file git has no HEAD copy of counts as all added; any other failure
   * leaves the stat unset.
   */
  async refresh(uri: string, fsPath: string, text: string): Promise<boolean> {
    const n = (this.sequence.get(uri) ?? 0) + 1;
    this.sequence.set(uri, n);
    const root = repoRootFor(fsPath, this.deps.roots());
    if (!root) return this.store(uri, undefined);
    const rel = fsPath.replace(/\\/g, "/").slice(root.replace(/\\/g, "/").replace(/\/+$/, "").length + 1);
    const signature = this.deps.signature(root, rel);
    let head = this.cache.get(uri);
    if (!head || head.signature !== signature) {
      let read: string | undefined;
      try {
        read = await this.deps.readHead(root, rel);
      } catch (error) {
        if (isNotInHead(error)) read = "";
      }
      if (this.sequence.get(uri) !== n) return false;
      if (read === undefined) {
        this.cache.delete(uri);
        return this.store(uri, undefined);
      }
      head = { signature, head: read };
      this.cache.set(uri, head);
    }
    return this.store(uri, this.deps.diff(head.head, text));
  }

  /** Drop everything held for a file that has no editor left. */
  forget(uri: string): void {
    this.cache.delete(uri);
    this.sequence.delete(uri);
    this.values.delete(uri);
  }

  private store(uri: string, stats: DiffStats | undefined): boolean {
    const before = this.values.get(uri);
    this.values.set(uri, stats);
    return before?.added !== stats?.added || before?.removed !== stats?.removed;
  }
}
