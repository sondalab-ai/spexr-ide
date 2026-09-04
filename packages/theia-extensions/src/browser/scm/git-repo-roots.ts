// Pure workspace-root ↔ repository-root helpers, free of Theia imports so they
// can be unit-tested without the browser DI runtime. Fed by
// `SpexrGitService.resolveToplevel` and by `WorkspaceService.tryGetRoots()`.

import { toRepoRelative } from "./relative-path.js";

/** A workspace folder paired with the repository top level that contains it. */
export interface RepoRootMapping {
  /** Filesystem path of the workspace folder. */
  readonly root: string;
  /** Repository top level containing it, or undefined outside a repository. */
  readonly toplevel: string | undefined;
}

/**
 * The distinct repository top levels behind a set of workspace folders, in
 * first-seen order.
 *
 * Folders outside a repository drop out, and several folders belonging to the
 * same repository — two subfolders of one checkout, or a checkout plus a
 * subfolder of it — collapse into a single entry. That collapse is the point:
 * the SCM panel must list a repository once, and its status is reported once
 * relative to the top level regardless of which folder was opened.
 */
export function distinctRepoRoots(mappings: readonly RepoRootMapping[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const { toplevel } of mappings) {
    if (toplevel === undefined || seen.has(toplevel)) continue;
    seen.add(toplevel);
    result.push(toplevel);
  }
  return result;
}

/**
 * The listed root that contains `path`, or undefined when none does. The
 * deepest match wins, so a nested root takes precedence over the ancestor it
 * sits in — the nested one is the more specific answer, and both would
 * otherwise match. A trailing separator is required for containment so
 * `/w/repo` does not swallow `/w/repo-other`; the root itself counts as
 * contained.
 */
export function containingRoot(roots: readonly string[], path: string): string | undefined {
  let best: string | undefined;
  for (const root of roots) {
    const normalized = root.endsWith("/") ? root.slice(0, -1) : root;
    if (path !== normalized && !path.startsWith(`${normalized}/`)) continue;
    if (best === undefined || normalized.length > best.length) best = normalized;
  }
  return best;
}

/** A file placed inside one of several repositories. */
export interface RepoLocation {
  /** Root of the repository containing the file. */
  readonly root: string;
  /** The file's path relative to that root, which is what git commands take. */
  readonly relPath: string;
}

/**
 * Locate a file among several repository roots. Undefined when no root contains
 * it, and also when the path IS a root — a directory has no blame, no diff and
 * no staging path, so the empty relative path is never a useful answer.
 *
 * Callers hold absolute filesystem paths (from a `file:` URI) while the git
 * service takes repository-relative ones, and with more than one repository open
 * the root to relativize against is no longer a given.
 */
export function locateInRepo(roots: readonly string[], fsPath: string): RepoLocation | undefined {
  const root = containingRoot(roots, fsPath);
  if (root === undefined || root === fsPath) return undefined;
  return { root, relPath: toRepoRelative(root, fsPath) };
}
