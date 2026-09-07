import type { GitPullResultDto } from "../../common/git-protocol.js";

/**
 * What to tell the user a pull did. A pull that brought nothing is the common
 * case and deserves to be distinguishable from one that rewrote the tree —
 * "Pulled from remote." said both.
 */
export function formatPullOutcome(result: GitPullResultDto | undefined): string {
  if (!result || result.changedFiles === 0) return "Already up to date.";
  const files = `${result.changedFiles} file${result.changedFiles === 1 ? "" : "s"}`;
  return `Pulled ${files} (+${result.insertions} -${result.deletions}).`;
}
