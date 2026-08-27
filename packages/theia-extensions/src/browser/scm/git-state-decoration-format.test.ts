import { describe, it, expect } from "vitest";
import { decorationForFile } from "./git-state-decoration-format.js";
import type { GitFileChangeDto } from "../../common/git-protocol.js";

function file(partial: Partial<GitFileChangeDto>): GitFileChangeDto {
  return { path: "f.ts", ...partial };
}

describe("decorationForFile", () => {
  it("maps an added file to A / addedResourceForeground", () => {
    expect(decorationForFile(file({ stagedState: "A" }))).toEqual({
      letter: "A",
      colorId: "gitDecoration.addedResourceForeground",
      tooltip: "Added",
    });
  });

  it("maps a modified file to M / modifiedResourceForeground", () => {
    expect(decorationForFile(file({ unstagedState: "M" }))?.letter).toBe("M");
    expect(decorationForFile(file({ unstagedState: "M" }))?.colorId).toBe(
      "gitDecoration.modifiedResourceForeground",
    );
  });

  it("maps a deleted file to D / deletedResourceForeground", () => {
    expect(decorationForFile(file({ stagedState: "D" }))?.letter).toBe("D");
    expect(decorationForFile(file({ stagedState: "D" }))?.colorId).toBe(
      "gitDecoration.deletedResourceForeground",
    );
  });

  it("maps a renamed file to R / renamedResourceForeground", () => {
    expect(decorationForFile(file({ stagedState: "R" }))?.letter).toBe("R");
    expect(decorationForFile(file({ stagedState: "R" }))?.colorId).toBe(
      "gitDecoration.renamedResourceForeground",
    );
  });

  it("maps a copied file to C, reusing the renamed colour", () => {
    expect(decorationForFile(file({ stagedState: "C" }))).toEqual({
      letter: "C",
      colorId: "gitDecoration.renamedResourceForeground",
      tooltip: "Copied",
    });
  });

  it("maps an untracked file (\"?\") to the VS Code convention letter U", () => {
    expect(decorationForFile(file({ unstagedState: "?" }))).toEqual({
      letter: "U",
      colorId: "gitDecoration.untrackedResourceForeground",
      tooltip: "Untracked",
    });
  });

  it("maps a conflicted file (unstagedState \"U\") to !", () => {
    expect(decorationForFile(file({ unstagedState: "U" }))).toEqual({
      letter: "!",
      colorId: "gitDecoration.conflictingResourceForeground",
      tooltip: "Conflicted",
    });
  });

  it("prefers the unstaged state when a file has both", () => {
    // Staged as modified, then edited again in the working tree.
    const result = decorationForFile(file({ stagedState: "M", unstagedState: "D" }));
    expect(result?.letter).toBe("D");
  });

  it("returns undefined when neither state is set", () => {
    expect(decorationForFile(file({}))).toBeUndefined();
  });
});
