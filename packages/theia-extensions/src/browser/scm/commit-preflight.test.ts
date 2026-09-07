import { describe, expect, it } from "vitest";
import type { GitFileChangeDto, GitStatusDto } from "../../common/git-protocol.js";
import { commitBlockReason } from "./commit-preflight.js";

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

describe("commitBlockReason", () => {
  it("allows a commit with something staged", () => {
    expect(commitBlockReason(status({ files: [staged] }))).toBeUndefined();
  });

  it("never blocks an open merge, which is concluded by a commit with an empty index", () => {
    expect(commitBlockReason(status({ mergeInProgress: true }))).toBeUndefined();
    expect(
      commitBlockReason(status({ mergeInProgress: true, files: [unstaged] })),
    ).toBeUndefined();
  });

  it("tells an unstaged working tree to stage first", () => {
    expect(commitBlockReason(status({ files: [unstaged] }))).toBe(
      "Nothing staged — stage the changes you want to commit first.",
    );
  });

  it("says the tree is clean when there is nothing at all", () => {
    expect(commitBlockReason(status())).toBe("Nothing to commit — the working tree is clean.");
  });
});
