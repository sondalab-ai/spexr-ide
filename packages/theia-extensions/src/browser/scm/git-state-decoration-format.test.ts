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
      bubble: false,
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
      bubble: false,
    });
  });

  it("maps an untracked file (\"?\") to the VS Code convention letter U", () => {
    expect(decorationForFile(file({ unstagedState: "?" }))).toEqual({
      letter: "U",
      colorId: "gitDecoration.untrackedResourceForeground",
      tooltip: "Untracked",
      bubble: false,
    });
  });

  it("maps a conflicted file (unstagedState \"U\") to !", () => {
    expect(decorationForFile(file({ unstagedState: "U" }))).toEqual({
      letter: "!",
      colorId: "gitDecoration.conflictingResourceForeground",
      tooltip: "Conflicted",
      bubble: false,
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

describe("the letters-only mapping (S6b, L7)", () => {
  it("never bubbles: a changed file marks its own row, not its folders", () => {
    for (const state of ["A", "M", "D", "R", "C", "U", "?"] as const) {
      expect(decorationForFile(file({ unstagedState: state }))?.bubble, state).toBe(false);
    }
  });

  it("shows Lumen's two letters as the demo does: M for a modified file, U for an untracked one", () => {
    expect(decorationForFile(file({ unstagedState: "M" }))?.letter).toBe("M");
    expect(decorationForFile(file({ unstagedState: "?" }))?.letter).toBe("U");
  });

  it("gives every state one single-character letter", () => {
    for (const state of ["A", "M", "D", "R", "C", "U", "?"] as const) {
      expect(decorationForFile(file({ unstagedState: state }))?.letter.length, state).toBe(1);
    }
  });
});
