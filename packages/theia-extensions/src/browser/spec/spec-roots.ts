// Spec lookup across every folder of a multi-root workspace. A workspace can
// hold several folders, each with its own `docs/specs/`, and spec numbering is
// per folder — so `0001-auth.md` may exist in two of them at once. Resolving a
// spec against `tryGetRoots()[0]` therefore does not merely miss the other
// folders, it can answer with the wrong folder's neighbouring files.

import URI from "@theia/core/lib/common/uri";
import { allSpecsDirs, SPEC_CONTEXT_DIR } from "../workspace-paths.js";
import { containingRoot } from "../scm/git-repo-roots.js";

/** Canonical spec filename, e.g. `0001-user-onboarding.md`. */
export const SPEC_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/;

/** Canonical spec filename with its slug (`0001-user-onboarding`) captured. */
export const SPEC_SLUG_RE = /^(\d{4}-[a-z0-9][a-z0-9-]*)\.md$/;

/** A spec collection directory paired with the workspace folder that owns it. */
export interface SpecLocation {
  /** Workspace folder holding the collection. */
  readonly root: URI;
  /** The collection directory itself, one of `allSpecsDirs(root)`. */
  readonly specsDir: URI;
}

/**
 * Every spec collection directory to probe, folder by folder.
 *
 * Roots keep their workspace order and each contributes its collections in
 * `allSpecsDirs` priority order, so a caller that stops at the first hit still
 * prefers the default layout over the superpowers one.
 */
export function specDirsForRoots(roots: readonly URI[]): SpecLocation[] {
  return roots.flatMap((root) => allSpecsDirs(root).map((specsDir) => ({ root, specsDir })));
}

/**
 * URI prefixes covering every spec collection, for filtering filesystem events.
 *
 * A watcher built from one root alone goes quiet for the other folders: their
 * specs then refresh only on an explicit user action.
 */
export function specDirPrefixes(roots: readonly URI[]): string[] {
  return specDirsForRoots(roots).map(({ specsDir }) => `${specsDir.toString()}/`);
}

/**
 * The folder and collection owning `uri`, or undefined when it is not a spec
 * file sitting directly in one of them.
 *
 * Containment is delegated to `containingRoot`, so a folder nested inside
 * another wins over its ancestor and `/w/repo` does not swallow `/w/repo-other`.
 * Depth is exact rather than prefix-based: a spec-looking file under
 * `docs/specs/.context/<slug>/` belongs to that spec, not to the collection.
 */
export function locateSpec(roots: readonly URI[], uri: URI): SpecLocation | undefined {
  if (!SPEC_FILE_RE.test(uri.path.base)) return undefined;
  const root = rootContaining(roots, uri);
  if (!root) return undefined;
  const parent = uri.parent.toString();
  const specsDir = allSpecsDirs(root).find((dir) => dir.toString() === parent);
  return specsDir ? { root, specsDir } : undefined;
}

/**
 * The workspace folder holding `uri`, or undefined when there is no URI to go
 * on or it lies outside every folder.
 *
 * Used to infer which folder a new spec belongs to from what the user is
 * looking at, so the common case needs no prompt; undefined is the signal to
 * ask instead of guessing.
 */
export function rootContaining(roots: readonly URI[], uri: URI | undefined): URI | undefined {
  if (!uri) return undefined;
  const sameScheme = roots.filter((root) => root.scheme === uri.scheme);
  const owner = containingRoot(
    sameScheme.map((root) => root.path.toString()),
    uri.path.toString(),
  );
  if (owner === undefined) return undefined;
  return sameScheme.find((candidate) => candidate.path.toString() === owner);
}

/**
 * The `.context/<slug>/` folder of the spec at `uri`, or undefined when `uri`
 * is not a spec in this workspace.
 *
 * Resolved from the spec's own collection, never from the first workspace
 * folder: numbering is per folder, so `0001-auth.md` can exist in two of them
 * and going through the first folder would read — and, when deleting, remove —
 * the other spec's context.
 */
export function specContextDirFor(roots: readonly URI[], uri: URI): URI | undefined {
  const located = locateSpec(roots, uri);
  const slug = uri.path.base.match(SPEC_SLUG_RE)?.[1];
  if (!located || !slug) return undefined;
  return located.specsDir.resolve(SPEC_CONTEXT_DIR).resolve(slug);
}

/** Specs of one workspace folder, ready to render under a heading. */
export interface SpecRootGroup<T> {
  /** The folder's URI, as a string — stable key for React lists. */
  readonly rootUri: string;
  /** The folder's name, for display. */
  readonly label: string;
  readonly items: readonly T[];
}

/**
 * Group items by the workspace folder they came from, in workspace order.
 *
 * Folders holding no items are dropped rather than rendered empty. Items whose
 * folder is no longer in the workspace — a folder removed while the view held a
 * snapshot — are kept in trailing groups rather than silently vanishing.
 */
export function groupByRoot<T extends { readonly rootUri: string }>(
  items: readonly T[],
  roots: readonly URI[],
): SpecRootGroup<T>[] {
  const order = [...roots.map((root) => root.toString())];
  for (const item of items) {
    if (!order.includes(item.rootUri)) order.push(item.rootUri);
  }
  const groups: SpecRootGroup<T>[] = [];
  for (const rootUri of order) {
    const owned = items.filter((item) => item.rootUri === rootUri);
    if (owned.length === 0) continue;
    groups.push({ rootUri, label: rootLabel(rootUri), items: owned });
  }
  return groups;
}

/**
 * The folder groups a spec list should render, empty when it should stay flat.
 *
 * A single-folder workspace gets no headings: one group would only put a title
 * above the list it already owns. Headings start earning their place at two.
 */
export function specGroupsFor<T extends { readonly rootUri: string }>(
  specs: readonly T[],
  roots: readonly URI[],
): SpecRootGroup<T>[] {
  return roots.length > 1 ? groupByRoot(specs, roots) : [];
}

/** Display name of a workspace folder: its last path segment, unescaped. */
export function rootLabel(rootUri: string): string {
  return new URI(rootUri).path.base;
}
