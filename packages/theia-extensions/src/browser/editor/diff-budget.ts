/**
 * What the breadcrumb meta may spend on a diff, and the small rules around it
 * (S6c, E7). A line diff is quadratic in the changed region (about 2.5 s for
 * a fully rewritten 3,000-line file, 30 s for 10,000, measured on Theia's
 * DiffComputer, which runs the same jsdiff), and it runs on the UI thread, so
 * the meta diffs only what changed (the lines the two texts share at their
 * start and end are cut away first, which does not change the counts), shows
 * nothing when what is left is over a budget, and the diff itself is given a
 * time limit (diff-stats.ts).
 *
 * Free of Theia, so it runs in plain node.
 */
import type { DiffStats } from "./breadcrumb-model.js";

/** The budget for the part of the two texts that differs: lines on either side, characters on either side, and how lopsided the sides may be. */
export const DIFF_BUDGET = { maxLines: 1000, maxChars: 512 * 1024, maxRatio: 10, ratioFloor: 200 } as const;

/** The text without a byte order mark, which would make a file's first line differ from HEAD's. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** A text's lines, split on any line end; the empty text has none, and a final line end ends the last line rather than starting another. */
export function linesOf(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** What is left of two line lists once the lines they share at the start and at the end are cut away. */
export function trimCommon(previous: readonly string[], current: readonly string[]): { previous: string[]; current: string[] } {
  let head = 0;
  const shortest = Math.min(previous.length, current.length);
  while (head < shortest && previous[head] === current[head]) head++;
  let tail = 0;
  while (tail < shortest - head && previous[previous.length - 1 - tail] === current[current.length - 1 - tail]) tail++;
  return { previous: previous.slice(head, previous.length - tail), current: current.slice(head, current.length - tail) };
}

/** Whether a differing region is cheap enough to diff on the UI thread. */
export function withinBudget(previous: readonly string[], current: readonly string[]): boolean {
  const { maxLines, maxChars, maxRatio, ratioFloor } = DIFF_BUDGET;
  const longest = Math.max(previous.length, current.length);
  if (longest > maxLines) return false;
  if (previous.reduce((n, l) => n + l.length, 0) > maxChars || current.reduce((n, l) => n + l.length, 0) > maxChars) return false;
  const shortest = Math.min(previous.length, current.length);
  return !(longest > ratioFloor && longest > maxRatio * Math.max(1, shortest));
}

/** What to do with two texts: the answer outright, the differing lines to count, or nothing (over budget). */
export type DiffPlan = { kind: "stats"; stats: DiffStats } | { kind: "diff"; previous: string[]; current: string[] } | { kind: "skip" };

/**
 * Plan the count of HEAD's text against the editor's. Identical texts, and a
 * region that is only added or only removed, are answered without a diff. The
 * lines left to compare are counted by a plain line diff (diff-stats.ts),
 * which agrees with `git diff --numstat`: a changed line is one added and one
 * removed, whether or not it is blank.
 */
export function planDiff(previousText: string, currentText: string): DiffPlan {
  const { previous, current } = trimCommon(linesOf(stripBom(previousText)), linesOf(stripBom(currentText)));
  if (previous.length === 0 || current.length === 0) return { kind: "stats", stats: { added: current.length, removed: previous.length } };
  if (!withinBudget(previous, current)) return { kind: "skip" };
  return { kind: "diff", previous, current };
}

/**
 * Whether git's refusal to show a path means the file is not in HEAD (new, or
 * a repository with no commit yet), as opposed to a failure. The messages are
 * git's: "path 'x' exists on disk, but not in 'HEAD'", "path 'x' does not
 * exist in 'HEAD'", "invalid object name 'HEAD'".
 */
export function isNotInHead(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /exists on disk, but not in|does not exist in|invalid object name|unknown revision or path|bad revision/i.test(message);
}

/** A path with forward slashes and no trailing one, so a Windows path and a URI path compare. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

/** The repository root holding `path`: the longest root it lies under, so a nested repository wins over its parent. */
export function repoRootFor(path: string, roots: readonly string[]): string | undefined {
  const target = normalizePath(path);
  let best: string | undefined;
  for (const root of roots) {
    const base = normalizePath(root);
    if (target.startsWith(`${base}/`) && (best === undefined || base.length > normalizePath(best).length)) best = root;
  }
  return best;
}

/** The part of a repository's status the head signature reads. */
export interface SignedStatus {
  readonly branch: string;
  readonly ahead: number;
  readonly behind: number;
  readonly files: ReadonlyArray<{ path: string; stagedState?: string | undefined; unstagedState?: string | undefined }>;
}

/**
 * What changes when HEAD can have: HEAD's own sha (a commit, a reset, a
 * rebase, with or without an upstream), the branch, the divergence and the
 * file's own status. The cached HEAD text of a file is kept while this is the
 * same. It is only as current as the sha it is given: the service reads that
 * afresh on each refresh (head-sha-cache.ts), and a commit made while no
 * refresh runs is seen at the next one.
 */
export function headSignature(status: SignedStatus | undefined, relPath: string, headSha = ""): string {
  if (!status) return `none|${headSha}`;
  const file = status.files.find((f) => f.path === relPath);
  return [headSha, status.branch, status.ahead, status.behind, file?.stagedState ?? "", file?.unstagedState ?? ""].join("|");
}
