import type { GitPullResultDto, GitStatusDto } from "../../common/git-protocol.js";
import { partitionUnstaged } from "./unstaged-partition.js";

/** What the working tree holds after a pull, for the outcome message. */
export interface LocalChanges {
  /** Unstaged edits to tracked files. Staged ones are in the index, not the working tree. */
  readonly modified: number;
  readonly untracked: number;
  readonly conflicted: number;
}

/** Count the working-tree rows of a status, or nothing when there is no status. */
export function localChanges(status: GitStatusDto | undefined): LocalChanges | undefined {
  if (!status) return undefined;
  const { tracked, untracked } = partitionUnstaged(status.files);
  return {
    modified: tracked.length,
    untracked: untracked.length,
    conflicted: status.files.filter((f) => f.unstagedState === "U").length,
  };
}

function count(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

/**
 * What to tell the user a pull did. A pull that brought nothing is the common
 * case and deserves to be distinguishable from one that rewrote the tree —
 * "Pulled from remote." said both.
 *
 * `local` is the working tree as it stands after the pull, and exists to stop
 * the other half of the misreading: a pull reported as touching 312 files, next
 * to a panel showing 49 rows, reads as if the pull put them there. Outside a
 * conflict it cannot have — a pull either commits its merge or stops on
 * conflicts — so those rows predate it, and saying so ends the guesswork.
 * Omit it to report the pull alone.
 */
export function formatPullOutcome(
  result: GitPullResultDto | undefined,
  local?: LocalChanges,
): string {
  const pulled =
    !result || result.changedFiles === 0
      ? "Already up to date."
      : `Pulled ${count(result.changedFiles, "file", "files")} (+${result.insertions} -${result.deletions}).`;
  const note = localNote(local);
  return note ? `${pulled} ${note}` : pulled;
}

/**
 * Conflicts win over the pre-existing rows: they are the one kind of row a pull
 * does create, and burying them under a reassurance would be the exact
 * inversion of the message's purpose.
 */
function localNote(local: LocalChanges | undefined): string | undefined {
  if (!local) return undefined;
  if (local.conflicted > 0) {
    return local.conflicted === 1
      ? "1 file has a conflict to resolve."
      : `${local.conflicted} files have conflicts to resolve.`;
  }
  const parts = [
    local.untracked > 0 ? count(local.untracked, "untracked file", "untracked files") : undefined,
    local.modified > 0 ? count(local.modified, "local change", "local changes") : undefined,
  ].filter((p): p is string => p !== undefined);
  if (parts.length === 0) return undefined;
  const verb = local.untracked + local.modified === 1 ? "was" : "were";
  return `${parts.join(" and ")} ${verb} already in the working tree.`;
}
