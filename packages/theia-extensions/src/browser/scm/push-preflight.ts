import type { GitStatusDto } from "../../common/git-protocol.js";

/**
 * Why a push would send nothing, or undefined when it would send something.
 *
 * A push with no commits ahead succeeds and reports success, which reads as
 * "your work is on the remote" when the work is in fact still sitting in the
 * index. The reason names what is actually holding the change back, so the
 * warning points at the next step rather than only denying the push.
 *
 * Never blocks a branch without an upstream: git reports `ahead: 0` there, but
 * the backend's push establishes tracking, which is exactly the first push of a
 * newly created branch.
 */
export function pushBlockReason(status: GitStatusDto): string | undefined {
  if (status.upstream === undefined) return undefined;
  if (status.ahead > 0) return undefined;

  const staged = status.files.filter((f) => f.stagedState !== undefined).length;
  if (staged > 0) {
    return `Nothing to push — ${count(staged, "staged change")} not yet committed. Commit first.`;
  }

  const uncommitted = status.files.length;
  if (uncommitted > 0) {
    return `Nothing to push — ${count(uncommitted, "change")} in the working tree, none of it staged or committed.`;
  }

  if (status.behind > 0) {
    return `Nothing to push — the branch is ${count(status.behind, "commit")} behind ${status.upstream}. Pull first.`;
  }

  return `Nothing to push — the branch is up to date with ${status.upstream}.`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
