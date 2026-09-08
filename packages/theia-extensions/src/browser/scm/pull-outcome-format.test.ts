import { describe, expect, it } from "vitest";
import { formatPullOutcome, localChanges, type LocalChanges } from "./pull-outcome-format.js";
import type { GitFileChangeDto, GitStatusDto } from "../../common/git-protocol.js";

function local(partial: Partial<LocalChanges>): LocalChanges {
  return { modified: 0, untracked: 0, conflicted: 0, ...partial };
}

function status(files: GitFileChangeDto[]): GitStatusDto {
  return { branch: "main", ahead: 0, behind: 0, files, isClean: false, mergeInProgress: false };
}

describe("formatPullOutcome", () => {
  it("distinguishes a pull that brought nothing", () => {
    expect(formatPullOutcome({ changedFiles: 0, insertions: 0, deletions: 0 })).toBe(
      "Already up to date.",
    );
  });

  it("reports what a pull actually changed", () => {
    expect(formatPullOutcome({ changedFiles: 3, insertions: 42, deletions: 7 })).toBe(
      "Pulled 3 files (+42 -7).",
    );
    expect(formatPullOutcome({ changedFiles: 1, insertions: 2, deletions: 0 })).toBe(
      "Pulled 1 file (+2 -0).",
    );
  });

  it("says nothing misleading when there is no repository to have pulled", () => {
    expect(formatPullOutcome(undefined)).toBe("Already up to date.");
  });

  it("credits pre-existing untracked files to the working tree, not to the pull", () => {
    // The case this clause exists for: a big pull next to a full panel read as
    // the pull having brought the panel's rows in.
    expect(
      formatPullOutcome({ changedFiles: 312, insertions: 890, deletions: 140 }, local({ untracked: 49 })),
    ).toBe("Pulled 312 files (+890 -140). 49 untracked files were already in the working tree.");
  });

  it("names both kinds of row when both are there", () => {
    expect(
      formatPullOutcome({ changedFiles: 3, insertions: 4, deletions: 1 }, local({ untracked: 49, modified: 2 })),
    ).toBe(
      "Pulled 3 files (+4 -1). 49 untracked files and 2 local changes were already in the working tree.",
    );
  });

  it("adds the clause to an up-to-date pull too, where the panel is just as puzzling", () => {
    expect(
      formatPullOutcome({ changedFiles: 0, insertions: 0, deletions: 0 }, local({ untracked: 49 })),
    ).toBe("Already up to date. 49 untracked files were already in the working tree.");
  });

  it("agrees in the singular", () => {
    expect(formatPullOutcome(undefined, local({ untracked: 1 }))).toBe(
      "Already up to date. 1 untracked file was already in the working tree.",
    );
    expect(formatPullOutcome(undefined, local({ modified: 1 }))).toBe(
      "Already up to date. 1 local change was already in the working tree.",
    );
  });

  it("reports conflicts instead — the one kind of row a pull does create", () => {
    expect(
      formatPullOutcome({ changedFiles: 8, insertions: 20, deletions: 3 }, local({ conflicted: 3, untracked: 49 })),
    ).toBe("Pulled 8 files (+20 -3). 3 files have conflicts to resolve.");
    expect(formatPullOutcome(undefined, local({ conflicted: 1 }))).toBe(
      "Already up to date. 1 file has a conflict to resolve.",
    );
  });

  it("adds no clause on a clean working tree, or with no status at all", () => {
    expect(formatPullOutcome({ changedFiles: 3, insertions: 4, deletions: 1 }, local({}))).toBe(
      "Pulled 3 files (+4 -1).",
    );
    expect(formatPullOutcome({ changedFiles: 3, insertions: 4, deletions: 1 }, undefined)).toBe(
      "Pulled 3 files (+4 -1).",
    );
  });
});

describe("localChanges", () => {
  it("counts the three kinds of working-tree row apart", () => {
    expect(
      localChanges(
        status([
          { path: "a.ts", unstagedState: "M" },
          { path: "b.ts", unstagedState: "D" },
          { path: "c.ts", unstagedState: "?" },
          { path: "d.ts", unstagedState: "U", conflict: "UU" },
        ]),
      ),
    ).toEqual({ modified: 2, untracked: 1, conflicted: 1 });
  });

  it("leaves staged-only files out — they are in the index, not the working tree", () => {
    expect(localChanges(status([{ path: "a.ts", stagedState: "A" }]))).toEqual({
      modified: 0,
      untracked: 0,
      conflicted: 0,
    });
  });

  it("is undefined when the refresh left no status to count", () => {
    expect(localChanges(undefined)).toBeUndefined();
  });
});
