import type { DiffStats } from "./breadcrumb-model.js";
import { isNotInHead, repoRootFor } from "./diff-budget.js";

/** What the stats read from the outside: the repositories, their state and HEAD's text. */
export interface StatsDeps {
  /** The roots of the workspace's repositories (file-system paths). */
  roots(): readonly string[];
  /** The repository's head signature for a file (`headSignature`, with HEAD's sha). */
  signature(root: string, relPath: string): Promise<string>;
  /** HEAD's text of a file; rejects with git's message when it is not there. */
  readHead(root: string, relPath: string): Promise<string>;
  /** The stat for the two texts, or undefined over the budget (`diffStats`). */
  diff(previous: string, current: string): DiffStats | undefined;
}

/**
 * The lines each open file differs from HEAD by (S6c, E7), with the costs
 * kept down: HEAD's text is cached per file until the repository's head
 * signature changes, the stat is remembered for a signature and a text so
 * repeated status events do not diff again, and each refresh carries a sequence number so an answer
 * that was overtaken by a newer one is dropped. Free of Theia, so the cache
 * and the staleness are tested apart from it.
 */
export class BreadcrumbStats {
  private readonly cache = new Map<string, { signature: string; head: string }>();
  private readonly sequence = new Map<string, number>();
  private readonly values = new Map<string, DiffStats | undefined>();
  /** The last stat computed, for the signature and text it was computed from. */
  private readonly memo = new Map<string, { signature: string; textKey: string; stats: DiffStats | undefined }>();

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
    const signature = await this.deps.signature(root, rel);
    if (this.sequence.get(uri) !== n) return false;
    const textKey = `${text.length}:${hashText(text)}`;
    const memo = this.memo.get(uri);
    if (memo && memo.signature === signature && memo.textKey === textKey) return this.store(uri, memo.stats);
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
        this.memo.delete(uri);
        return this.store(uri, undefined);
      }
      head = { signature, head: read };
      this.cache.set(uri, head);
    }
    const stats = this.deps.diff(head.head, text);
    this.memo.set(uri, { signature, textKey, stats });
    return this.store(uri, stats);
  }

  /** Drop everything held for a file that has no editor left. */
  forget(uri: string): void {
    this.cache.delete(uri);
    this.sequence.delete(uri);
    this.values.delete(uri);
    this.memo.delete(uri);
  }

  private store(uri: string, stats: DiffStats | undefined): boolean {
    const before = this.values.get(uri);
    this.values.set(uri, stats);
    return before?.added !== stats?.added || before?.removed !== stats?.removed;
  }
}

/** A fast 32-bit hash of a text (FNV-1a), with its length enough to tell an edit from a repeat. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
