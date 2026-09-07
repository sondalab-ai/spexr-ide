import type { GitStatusDto } from "../../common/git-protocol.js";

/**
 * Why a commit would fail before git is asked, or undefined when it would work.
 *
 * Without this the user gets git's own "nothing added to commit but untracked
 * files present" in an error toast, which says what happened but not what to
 * do about it.
 *
 * An open merge is the deliberate exception: concluding one is a commit with an
 * empty index, and refusing it would leave no way to finish the merge from the
 * panel. See {@link GitStatusDto.mergeInProgress}.
 */
export function commitBlockReason(status: GitStatusDto): string | undefined {
  if (status.mergeInProgress) return undefined;
  if (status.files.some((f) => f.stagedState !== undefined)) return undefined;

  if (status.files.length > 0) {
    return "Nothing staged — stage the changes you want to commit first.";
  }
  return "Nothing to commit — the working tree is clean.";
}
