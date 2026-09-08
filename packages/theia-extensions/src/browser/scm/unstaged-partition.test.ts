import { describe, it, expect } from "vitest";
import { partitionUnstaged } from "./unstaged-partition.js";
import type { GitFileChangeDto } from "../../common/git-protocol.js";

function file(partial: Partial<GitFileChangeDto>): GitFileChangeDto {
  return { path: "f.ts", ...partial };
}

describe("partitionUnstaged", () => {
  it("sends an untracked file to untracked and a modified one to tracked", () => {
    const modified = file({ path: "a.ts", unstagedState: "M" });
    const untracked = file({ path: "b.ts", unstagedState: "?" });

    expect(partitionUnstaged([modified, untracked])).toEqual({
      tracked: [modified],
      untracked: [untracked],
    });
  });

  it("keeps deletions and renames on the tracked side", () => {
    const deleted = file({ path: "a.ts", unstagedState: "D" });
    const renamed = file({ path: "b.ts", unstagedState: "R" });

    expect(partitionUnstaged([deleted, renamed])).toEqual({
      tracked: [deleted, renamed],
      untracked: [],
    });
  });

  it("drops conflicts from both sides — they belong to the conflicts group", () => {
    const conflicted = file({ path: "a.ts", unstagedState: "U", conflict: "UU" });

    expect(partitionUnstaged([conflicted])).toEqual({ tracked: [], untracked: [] });
  });

  it("drops a staged-only file, which has no working-tree row at all", () => {
    const stagedOnly = file({ path: "a.ts", stagedState: "A" });

    expect(partitionUnstaged([stagedOnly])).toEqual({ tracked: [], untracked: [] });
  });

  it("keeps the unstaged half of a file that is both staged and edited again", () => {
    const both = file({ path: "a.ts", stagedState: "A", unstagedState: "M" });

    expect(partitionUnstaged([both])).toEqual({ tracked: [both], untracked: [] });
  });

  it("returns two empty sides for an empty status", () => {
    expect(partitionUnstaged([])).toEqual({ tracked: [], untracked: [] });
  });
});
