import type { GitFileChangeDto } from "../../common/git-protocol.js";

/**
 * The working-tree rows, split by whether git has ever seen the file.
 * Conflicts belong to neither: they are their own group.
 */
export interface UnstagedPartition {
  readonly tracked: readonly GitFileChangeDto[];
  readonly untracked: readonly GitFileChangeDto[];
}

/**
 * Split the unstaged half of a status into tracked edits and untracked files.
 *
 * The two used to share one "Changes" group, so a directory of build output
 * git had never seen counted the same as an edit the user made — a pull into a
 * tree holding test artifacts read as "49 changes" when the pull had touched
 * none of them. Separate groups let the panel say "Changes 0 · Untracked 49".
 */
export function partitionUnstaged(files: readonly GitFileChangeDto[]): UnstagedPartition {
  const tracked: GitFileChangeDto[] = [];
  const untracked: GitFileChangeDto[] = [];
  for (const f of files) {
    if (f.unstagedState === undefined || f.unstagedState === "U") continue;
    (f.unstagedState === "?" ? untracked : tracked).push(f);
  }
  return { tracked, untracked };
}
