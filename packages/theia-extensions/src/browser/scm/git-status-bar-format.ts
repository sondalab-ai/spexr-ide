/** The branch entry's text: the branch glyph and the name, which is the one run set as data (S6d, D15). */
export function formatBranchEntry(s: { branch: string }): string {
  return `$(git-branch) ${s.branch}`;
}

/**
 * The divergence beside the branch, e.g. "↑2↓3", in an entry of its own so its
 * words stay the bar's muted sans while the branch's name is the mono at the
 * primary ink (the bar's text runs are split at glyphs, and the arrows are
 * text, as Lumen's). An open merge is appended because it is otherwise
 * invisible once its conflicts are resolved: the panel's groups can all be
 * empty with the merge still uncommitted. Undefined when there is nothing to
 * say.
 */
export function formatDivergenceEntry(s: { ahead: number; behind: number; mergeInProgress?: boolean }): string | undefined {
  const arrows = `${s.ahead > 0 ? `↑${s.ahead}` : ""}${s.behind > 0 ? `↓${s.behind}` : ""}`;
  const merging = s.mergeInProgress ? "(merging)" : "";
  const text = [arrows, merging].filter(Boolean).join(" ");
  return text || undefined;
}

/** What the "synced" item reads: the branch's divergence and whether the last fetch worked. */
export interface SyncState {
  readonly upstream?: string | undefined;
  readonly behind: number;
  readonly fetchFailed: boolean;
}

/** The sync item as the bar draws it: its text (with Theia's `$(icon)` syntax), a tooltip and the screen reader's name. */
export interface SyncEntry {
  readonly text: string;
  readonly tooltip: string;
  readonly label: string;
}

/**
 * The "synced" item (S6d, S3, D16). "synced" means no commit to pull and a
 * fetch that did not fail; otherwise it says "↓n to pull" or "fetch failed". A branch
 * with no upstream has nothing to sync with, so there is no item (undefined).
 * Clicking it fetches, whether or not autofetch is on.
 */
export function formatSyncEntry(s: SyncState): SyncEntry | undefined {
  if (!s.upstream) return undefined;
  if (s.fetchFailed) {
    return { text: "$(warning) fetch failed", tooltip: `The last fetch from ${s.upstream} failed — click to try again`, label: "Fetch failed, click to try again" };
  }
  if (s.behind > 0) {
    return { text: `$(sync) ↓${s.behind} to pull`, tooltip: `${s.behind} commit${s.behind === 1 ? "" : "s"} to pull from ${s.upstream} — click to fetch`, label: `${s.behind} to pull, click to fetch` };
  }
  return { text: "$(sync) synced", tooltip: `Up to date with ${s.upstream} as of the last fetch — click to fetch`, label: "Synced, click to fetch" };
}
