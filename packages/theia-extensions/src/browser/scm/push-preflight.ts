import type { GitStatusDto } from "../../common/git-protocol.js";

/**
 * Why a push should not run, or undefined when it should.
 *
 * Two kinds of pointless push. One sends nothing and still succeeds, which
 * reads as "your work is on the remote" when the work is in fact still sitting
 * in the index. The other has commits to send but is behind, and git rejects it
 * as a non-fast-forward — accurately, and in language that assumes you already
 * know what to do. Both get a reason that names the next step instead.
 *
 * Never blocks a branch without an upstream: git reports `ahead: 0` there, but
 * the backend's push establishes tracking, which is exactly the first push of a
 * newly created branch.
 */
export function pushBlockReason(status: GitStatusDto): string | undefined {
  if (status.upstream === undefined) return undefined;

  if (status.ahead > 0) {
    if (status.behind === 0) return undefined;
    // Only reachable because the IDE fetches on its own; on a stale `behind`
    // this stays silent and git rejects the push itself, as it did before.
    return `Push would be rejected — ${count(status.ahead, "commit")} to send, but the branch is ${count(status.behind, "commit")} behind ${status.upstream}. Pull first.`;
  }

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
