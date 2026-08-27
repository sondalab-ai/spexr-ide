/** Branch plus divergence, e.g. "$(git-branch) main ↑2↓3". */
export function formatBranchEntry(s: { branch: string; ahead: number; behind: number }): string {
  const arrows = `${s.ahead > 0 ? `↑${s.ahead}` : ""}${s.behind > 0 ? `↓${s.behind}` : ""}`;
  return `$(git-branch) ${s.branch}${arrows ? ` ${arrows}` : ""}`;
}
