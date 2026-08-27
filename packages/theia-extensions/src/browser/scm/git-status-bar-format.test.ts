import { describe, it, expect } from "vitest";
import { formatBranchEntry } from "./git-status-bar-format.js";

describe("formatBranchEntry", () => {
  it("shows just the branch when in sync", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 0, behind: 0 })).toBe("$(git-branch) main");
  });
  it("shows ahead only", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 2, behind: 0 })).toBe(
      "$(git-branch) main ↑2",
    );
  });
  it("shows behind only", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 0, behind: 3 })).toBe(
      "$(git-branch) main ↓3",
    );
  });
  it("shows both, ahead first", () => {
    expect(formatBranchEntry({ branch: "dev", ahead: 2, behind: 3 })).toBe(
      "$(git-branch) dev ↑2↓3",
    );
  });
  it("marks an open merge, which is otherwise invisible once resolved", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 0, behind: 0, mergeInProgress: true })).toBe(
      "$(git-branch) main (merging)",
    );
    expect(formatBranchEntry({ branch: "main", ahead: 2, behind: 0, mergeInProgress: true })).toBe(
      "$(git-branch) main ↑2 (merging)",
    );
  });
});
