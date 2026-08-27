/**
 * Path relative to the repository root, which is what git commands expect.
 * The panel holds absolute filesystem URIs; passing those to `git add` only
 * happened to work because simple-git runs with cwd at the root.
 */
export function toRepoRelative(root: string, fsPath: string): string {
  if (!fsPath.startsWith("/")) return fsPath;
  const normalized = root.endsWith("/") ? root.slice(0, -1) : root;
  if (fsPath === normalized) return "";
  const base = `${normalized}/`;
  // The trailing separator check prevents /w/repo matching /w/repo-other.
  return fsPath.startsWith(base) ? fsPath.slice(base.length) : fsPath;
}
