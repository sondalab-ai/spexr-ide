import { describe, it, expect } from "vitest";
import { formatBranchEntry, formatSyncEntry } from "./git-status-bar-format.js";

describe("formatBranchEntry", () => {
  it("shows just the branch when in sync", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 0, behind: 0 })).toBe("$(git-branch) main");
  });
  it("shows ahead only", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 2, behind: 0 })).toBe(
      "$(git-branch) main $(arrow-up)2",
    );
  });
  it("shows behind only", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 0, behind: 3 })).toBe(
      "$(git-branch) main $(arrow-down)3",
    );
  });
  it("shows both, ahead first", () => {
    expect(formatBranchEntry({ branch: "dev", ahead: 2, behind: 3 })).toBe(
      "$(git-branch) dev $(arrow-up)2$(arrow-down)3",
    );
  });
  it("marks an open merge, which is otherwise invisible once resolved", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 0, behind: 0, mergeInProgress: true })).toBe(
      "$(git-branch) main (merging)",
    );
    expect(formatBranchEntry({ branch: "main", ahead: 2, behind: 0, mergeInProgress: true })).toBe(
      "$(git-branch) main $(arrow-up)2 (merging)",
    );
  });
});

describe("formatSyncEntry (S6d, S3, D16)", () => {
  const up = "origin/main";

  it("says synced with nothing to pull and a fetch that worked", () => {
    expect(formatSyncEntry({ upstream: up, behind: 0, fetchFailed: false })?.text).toBe("$(sync) synced");
  });

  it("says how many commits to pull", () => {
    expect(formatSyncEntry({ upstream: up, behind: 3, fetchFailed: false })?.text).toBe("$(sync) ↓3 to pull");
    expect(formatSyncEntry({ upstream: up, behind: 1, fetchFailed: false })?.tooltip).toContain("1 commit to pull");
    expect(formatSyncEntry({ upstream: up, behind: 2, fetchFailed: false })?.tooltip).toContain("2 commits to pull");
  });

  it("says a fetch failed, before anything about the count, which may be stale", () => {
    expect(formatSyncEntry({ upstream: up, behind: 0, fetchFailed: true })?.text).toBe("$(warning) fetch failed");
    expect(formatSyncEntry({ upstream: up, behind: 4, fetchFailed: true })?.text).toBe("$(warning) fetch failed");
  });

  it("is no item on a branch with no upstream", () => {
    expect(formatSyncEntry({ behind: 0, fetchFailed: false })).toBeUndefined();
    expect(formatSyncEntry({ behind: 0, fetchFailed: true })).toBeUndefined();
  });

  it("gives each state a name for a screen reader that says the click", () => {
    for (const state of [{ behind: 0, fetchFailed: false }, { behind: 2, fetchFailed: false }, { behind: 0, fetchFailed: true }]) {
      expect(formatSyncEntry({ upstream: up, ...state })?.label).toMatch(/click to (fetch|try again)/);
    }
  });
});
