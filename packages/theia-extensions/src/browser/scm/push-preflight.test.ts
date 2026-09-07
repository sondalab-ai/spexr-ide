import { describe, expect, it } from "vitest";
import type { GitFileChangeDto, GitStatusDto } from "../../common/git-protocol.js";
import { pushBlockReason } from "./push-preflight.js";

function status(over: Partial<GitStatusDto> = {}): GitStatusDto {
  return {
    branch: "main",
    upstream: "origin/main",
    ahead: 0,
    behind: 0,
    files: [],
    isClean: true,
    mergeInProgress: false,
    ...over,
  };
}

const staged: GitFileChangeDto = { path: "a.ts", stagedState: "M" };
const unstaged: GitFileChangeDto = { path: "b.ts", unstagedState: "M" };

describe("pushBlockReason", () => {
  it("allows the first push of a branch with no upstream, where ahead is 0 anyway", () => {
    expect(pushBlockReason(status({ upstream: undefined, files: [staged] }))).toBeUndefined();
  });

  it("allows a push that has commits to send and nothing to catch up on", () => {
    expect(pushBlockReason(status({ ahead: 2 }))).toBeUndefined();
    expect(pushBlockReason(status({ ahead: 2, files: [staged] }))).toBeUndefined();
  });

  it("stops a non-fast-forward push before git rejects it in its own words", () => {
    expect(pushBlockReason(status({ ahead: 1, behind: 3 }))).toBe(
      "Push would be rejected — 1 commit to send, but the branch is 3 commits behind origin/main. Pull first.",
    );
  });

  it("says nothing about divergence on a branch with no upstream to diverge from", () => {
    expect(pushBlockReason(status({ upstream: undefined, ahead: 1, behind: 3 }))).toBeUndefined();
  });

  it("names the staged changes, which is what the success toast otherwise hides", () => {
    expect(pushBlockReason(status({ files: [staged] }))).toBe(
      "Nothing to push — 1 staged change not yet committed. Commit first.",
    );
    expect(pushBlockReason(status({ files: [staged, { path: "c.ts", stagedState: "A" }] }))).toBe(
      "Nothing to push — 2 staged changes not yet committed. Commit first.",
    );
  });

  it("reports an unstaged-only working tree without telling the user to commit", () => {
    expect(pushBlockReason(status({ files: [unstaged] }))).toBe(
      "Nothing to push — 1 change in the working tree, none of it staged or committed.",
    );
  });

  it("points a clean branch that is behind at pull instead", () => {
    expect(pushBlockReason(status({ behind: 3 }))).toBe(
      "Nothing to push — the branch is 3 commits behind origin/main. Pull first.",
    );
  });

  it("says the branch is up to date when there is nothing at all", () => {
    expect(pushBlockReason(status())).toBe(
      "Nothing to push — the branch is up to date with origin/main.",
    );
  });
});
