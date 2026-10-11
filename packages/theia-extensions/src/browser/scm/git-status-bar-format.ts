/** The branch entry's text: the branch glyph and the name, which is the one run set as data (S6d, D15). */
export function formatBranchEntry(s: { branch: string }): string {
  return `$(git-branch) ${s.branch}`;
}

/** The divergence pill as the bar draws it: its text and the screen reader's name. */
export interface DivergenceEntry {
  readonly text: string;
  readonly label: string;
}

/**
 * The commits ahead beside the branch, e.g. "↑2", in an entry of its own so
 * its words stay the bar's muted sans while the branch's name is the mono at
 * the primary ink (the bar's text runs are split at glyphs, and the arrow is
 * text, as Lumen's). Commits behind are the sync item's ("↓3 to pull"), not
 * said twice. An open merge is appended because it is otherwise invisible once
 * its conflicts are resolved: the panel's groups can all be empty with the
 * merge still uncommitted. Undefined when there is nothing to say.
 */
export function formatDivergenceEntry(s: { ahead: number; mergeInProgress?: boolean }): DivergenceEntry | undefined {
  const texts: string[] = [];
  const labels: string[] = [];
  if (s.ahead > 0) {
    texts.push(`↑${s.ahead}`);
    labels.push(`${s.ahead} commit${s.ahead === 1 ? "" : "s"} ahead`);
  }
  if (s.mergeInProgress) {
    texts.push("(merging)");
    labels.push("merge in progress");
  }
  return texts.length ? { text: texts.join(" "), label: labels.join(", ") } : undefined;
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

/** The part of a repository's status the bar's git entries read. */
export interface GitBarStatus {
  readonly branch: string;
  readonly upstream?: string | undefined;
  readonly ahead: number;
  readonly behind: number;
  readonly mergeInProgress?: boolean;
}

/** The three git entries of the bar, each present or absent. */
export interface GitBarEntries {
  readonly branch?: { text: string; tooltip: string };
  readonly divergence?: DivergenceEntry & { tooltip: string };
  readonly sync?: SyncEntry;
}

/**
 * Which of the bar's git entries there are for a repository's status (S6d):
 * none without a status, the branch with a tooltip, the divergence only when
 * there is something to say, the sync item only on a branch with an upstream.
 */
export function planGitEntries(s: GitBarStatus | undefined, fetchFailed: boolean): GitBarEntries {
  if (!s) return {};
  const tooltip = s.mergeInProgress ? "Merge in progress — commit to conclude it" : s.upstream ? `Tracking ${s.upstream}` : "No upstream branch";
  const divergence = formatDivergenceEntry(s);
  const sync = formatSyncEntry({ upstream: s.upstream, behind: s.behind, fetchFailed });
  return {
    branch: { text: formatBranchEntry(s), tooltip },
    ...(divergence ? { divergence: { ...divergence, tooltip } } : {}),
    ...(sync ? { sync } : {}),
  };
}

/** The status bar as far as the git entries use it, so they are applied against a fake in tests. */
export interface EntryBar<E> {
  setElement(id: string, entry: E): unknown;
  removeElement(id: string): unknown;
}

/** The ids the three entries are set under. */
export const GIT_ENTRY_IDS = { branch: "spexr-git-branch", divergence: "spexr-git-divergence", sync: "spexr-git-sync" } as const;

/**
 * Set the entries that exist and remove the ones that do not, so a pill that
 * has nothing to say any more (ahead back to 0, the upstream gone) leaves the
 * bar. `make` builds the Theia entry from an id and its text parts.
 */
export function applyGitEntries<E>(
  bar: EntryBar<E>,
  entries: GitBarEntries,
  make: (id: keyof typeof GIT_ENTRY_IDS, parts: { text: string; tooltip: string; label?: string }) => E,
): void {
  for (const key of Object.keys(GIT_ENTRY_IDS) as Array<keyof typeof GIT_ENTRY_IDS>) {
    const parts = entries[key];
    if (parts) void bar.setElement(GIT_ENTRY_IDS[key], make(key, parts));
    else void bar.removeElement(GIT_ENTRY_IDS[key]);
  }
}
