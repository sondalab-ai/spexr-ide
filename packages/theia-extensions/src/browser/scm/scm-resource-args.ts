import { toRepoRelative } from "./relative-path.js";

/**
 * Repository-relative paths for SCM resources spread into a command handler.
 * Theia spreads each selected resource as an individual argument
 * (ActionMenuNode.run(path, ...args) -> commands.executeCommand(id, ...args)),
 * so `items` is the already-spread rest-args array — never a single resource,
 * and never wrapped in one more array. Deduplicated because a file with both
 * a staged and an unstaged change is two distinct rows sharing one
 * repository-relative path.
 */
export function resourcePaths(root: string, items: unknown[]): string[] {
  const paths = items
    .map((i) => (i as { sourceUri?: { path?: { toString(): string } } })?.sourceUri?.path?.toString())
    .filter((p): p is string => typeof p === "string")
    .map((p) => toRepoRelative(root, p));
  return [...new Set(paths)];
}

/** The SCM resource group id ("index", "workingTree", or "conflicts") a resource belongs to, if any. */
export function resourceGroupId(item: unknown): string | undefined {
  return (item as { group?: { id?: string } })?.group?.id;
}

/**
 * True when there is at least one item and every one of them belongs to the
 * given SCM resource group. Used to restrict a command's visibility to the
 * rows it is safe to act on (e.g. Discard must not appear on a Staged
 * Changes row, since that would silently discard an unrelated working-tree
 * edit sharing the same path).
 */
export function allInGroup(items: unknown[], groupId: string): boolean {
  return items.length > 0 && items.every((i) => resourceGroupId(i) === groupId);
}
