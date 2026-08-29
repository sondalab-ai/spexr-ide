/**
 * Branch plus divergence, e.g. "$(git-branch) main ↑2↓3".
 *
 * An open merge is appended because it is otherwise invisible once its
 * conflicts are resolved: the panel's groups can all be empty with the merge
 * still uncommitted.
 */
export function formatBranchEntry(s: {
  branch: string;
  ahead: number;
  behind: number;
  mergeInProgress?: boolean;
}): string {
  const arrows = `${s.ahead > 0 ? `↑${s.ahead}` : ""}${s.behind > 0 ? `↓${s.behind}` : ""}`;
  const merging = s.mergeInProgress ? " (merging)" : "";
  return `$(git-branch) ${s.branch}${arrows ? ` ${arrows}` : ""}${merging}`;
}
