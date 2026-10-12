/**
 * The root among `roots` that holds `uri`: the deepest one, so a repository
 * nested in another wins for its own files. Roots and the uri are URI strings;
 * a root matches itself and anything under it, never a sibling that merely
 * shares a name prefix (`/a/spexr` is not above `/a/spexr-wt`).
 */
export function repositoryRootFor(roots: readonly string[], uri: string): string | undefined {
  let best: string | undefined;
  for (const root of roots) {
    const base = root.endsWith("/") ? root : `${root}/`;
    const inside = uri === root || uri.startsWith(base);
    if (inside && (best === undefined || root.length > best.length)) best = root;
  }
  return best;
}
