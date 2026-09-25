/**
 * Whether a batch of changed filesystem paths calls for a status refresh of the
 * repository at `root`. Only paths inside it count, so a change in one
 * workspace folder no longer refreshes every repository. Paths inside its git
 * dir do not count either: the backend watches that itself and names the
 * repository when it changes.
 */
export function touchesRepository(root: string, changedPaths: readonly string[]): boolean {
  const normalized = root.endsWith("/") ? root.slice(0, -1) : root;
  const base = `${normalized}/`;
  const gitDir = `${base}.git`;
  return changedPaths.some(
    (p) =>
      (p === normalized || p.startsWith(base)) && p !== gitDir && !p.startsWith(`${gitDir}/`),
  );
}
