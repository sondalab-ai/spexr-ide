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
    .map((i) =>
      (i as { sourceUri?: { path?: { toString(): string } } })?.sourceUri?.path?.toString(),
    )
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

/**
 * True when a *group*-menu command was invoked on the group with the given
 * id, OR when there are no arguments at all. A group menu (e.g. the Stage
 * All / Unstage All buttons on a Changes / Staged Changes header) receives a
 * single `ScmResourceGroup` as its sole argument
 * (`ScmResourceGroupElement.contextMenuArgs` in @theia/scm) — not the spread
 * list of resources the per-resource menus receive, so this cannot reuse
 * {@link allInGroup}. The empty-args branch is what keeps the command
 * visible in the command palette: `QuickCommandService` calls
 * `isVisible(id)` with no arguments at all, so a strict group-id match alone
 * would silently remove the command from the palette.
 */
export function isResourceGroup(items: unknown[], groupId: string): boolean {
  return (
    items.length === 0 ||
    (items.length === 1 && (items[0] as { id?: string } | undefined)?.id === groupId)
  );
}

/**
 * The two conflicts where the file exists on one side of the merge and not the
 * other, so "resolved" has two legitimate meanings: keep the file, or accept
 * the deletion. `UD` is deleted by them, `DU` deleted by us. Every other
 * unmerged pair has a single outcome, which staging expresses.
 */
const DELETE_MODIFY_PAIRS = new Set(["UD", "DU"]);

/** Whether an SCM row is a conflict row of the given kind, if it carries one. */
function conflictKind(item: unknown): string | undefined {
  return (item as { conflict?: string })?.conflict;
}

/**
 * True when every item is a delete/modify conflict row — the rows that must
 * offer Keep File and Accept Deletion instead of a single Mark Resolved.
 * Empty is false: these commands act on a selection and have nothing to do
 * without one, unlike the group-wide commands.
 */
export function allDeleteModifyConflicts(items: unknown[]): boolean {
  return (
    allInGroup(items, "conflicts") &&
    items.every((i) => DELETE_MODIFY_PAIRS.has(conflictKind(i) ?? ""))
  );
}

/**
 * True when every item is a conflict row that staging resolves outright —
 * `UU`, `AA`, `DD`, `AU`, `UA`. A row with no conflict kind counts here: it
 * predates the field or comes from a status this build did not classify, and
 * the old behaviour (Mark Resolved stages it) is the safe default.
 */
export function allSingleOutcomeConflicts(items: unknown[]): boolean {
  return (
    allInGroup(items, "conflicts") &&
    items.every((i) => !DELETE_MODIFY_PAIRS.has(conflictKind(i) ?? ""))
  );
}
