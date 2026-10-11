import { describe, it, expect } from "vitest";
import { formatBranchEntry, formatDivergenceEntry, formatSyncEntry } from "./git-status-bar-format.js";

describe("formatBranchEntry", () => {
  it("is the branch glyph and the name", () => {
    expect(formatBranchEntry({ branch: "main" })).toBe("$(git-branch) main");
  });
});

describe("formatDivergenceEntry", () => {
  it("is nothing when in sync", () => {
    expect(formatDivergenceEntry({ ahead: 0, behind: 0 })).toBeUndefined();
  });
  it("shows ahead only, behind only, or both, ahead first", () => {
    expect(formatDivergenceEntry({ ahead: 2, behind: 0 })).toBe("↑2");
    expect(formatDivergenceEntry({ ahead: 0, behind: 3 })).toBe("↓3");
    expect(formatDivergenceEntry({ ahead: 2, behind: 3 })).toBe("↑2↓3");
  });
  it("marks an open merge, which is otherwise invisible once resolved", () => {
    expect(formatDivergenceEntry({ ahead: 0, behind: 0, mergeInProgress: true })).toBe("(merging)");
    expect(formatDivergenceEntry({ ahead: 2, behind: 0, mergeInProgress: true })).toBe("↑2 (merging)");
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
