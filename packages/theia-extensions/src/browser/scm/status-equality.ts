import type { GitStatusDto } from "../../common/git-protocol.js";

/**
 * Whether a fresh status says nothing the previous one did not. Every status
 * change redraws the panel, the file decorations and every tree showing them,
 * so a refresh that finds the same status must not report one. Both come from
 * the same backend mapping, in git's order, so their serializations match
 * exactly when their contents do.
 */
export function sameStatus(previous: GitStatusDto | undefined, next: GitStatusDto): boolean {
  return previous !== undefined && JSON.stringify(previous) === JSON.stringify(next);
}

/** One workspace folder's `git ls-files` ignore list, as fetched. */
export interface IgnoreListing {
  readonly root: string;
  readonly paths: readonly string[];
}

/**
 * Whether a fresh set of ignore listings matches the previous one. The ignore
 * provider refetches on every file change, and announcing an unchanged set makes
 * every file tree re-query and redraw its decorations.
 */
export function sameIgnoreListings(
  previous: readonly IgnoreListing[] | undefined,
  next: readonly IgnoreListing[],
): boolean {
  return previous !== undefined && JSON.stringify(previous) === JSON.stringify(next);
}
