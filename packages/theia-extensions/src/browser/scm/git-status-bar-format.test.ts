import { describe, it, expect } from "vitest";
import { applyGitEntries, formatBranchEntry, formatDivergenceEntry, formatSyncEntry, planGitEntries } from "./git-status-bar-format.js";

describe("formatBranchEntry", () => {
  it("is the branch glyph and the name", () => {
    expect(formatBranchEntry({ branch: "main" })).toBe("$(git-branch) main");
  });
});

describe("formatDivergenceEntry", () => {
  it("is nothing when nothing is ahead", () => {
    expect(formatDivergenceEntry({ ahead: 0 })).toBeUndefined();
  });
  it("shows the commits ahead, with a name for a screen reader", () => {
    expect(formatDivergenceEntry({ ahead: 2 })).toEqual({ text: "↑2", label: "2 commits ahead" });
    expect(formatDivergenceEntry({ ahead: 1 })).toEqual({ text: "↑1", label: "1 commit ahead" });
  });
  it("leaves the commits behind to the sync item, which says them once", () => {
    expect(formatDivergenceEntry({ ahead: 0, ...({ behind: 3 } as object) })).toBeUndefined();
  });
  it("marks an open merge, which is otherwise invisible once resolved", () => {
    expect(formatDivergenceEntry({ ahead: 0, mergeInProgress: true })).toEqual({ text: "(merging)", label: "merge in progress" });
    expect(formatDivergenceEntry({ ahead: 2, mergeInProgress: true })).toEqual({ text: "↑2 (merging)", label: "2 commits ahead, merge in progress" });
  });
});

describe("planGitEntries and applyGitEntries (S6d)", () => {
  const status = { branch: "main", upstream: "origin/main", ahead: 2, behind: 0 };

  /** A fake bar: the entries it holds, by id. */
  function bar() {
    const held = new Map<string, unknown>();
    return { held, setElement: (id: string, entry: unknown) => void held.set(id, entry), removeElement: (id: string) => void held.delete(id) };
  }
  const make = (id: string, parts: { text: string }) => ({ id, text: parts.text });

  it("has the three entries on a branch with an upstream and commits ahead", () => {
    const b = bar();
    applyGitEntries(b, planGitEntries(status, "ok"), make);
    expect([...b.held.keys()]).toEqual(["spexr-git-branch", "spexr-git-divergence", "spexr-git-sync"]);
    expect(b.held.get("spexr-git-sync")).toMatchObject({ text: "$(sync) synced" });
  });

  it("removes the divergence pill when ahead goes back to 0, and keeps the others", () => {
    const b = bar();
    applyGitEntries(b, planGitEntries(status, "ok"), make);
    applyGitEntries(b, planGitEntries({ ...status, ahead: 0 }, "ok"), make);
    expect([...b.held.keys()]).toEqual(["spexr-git-branch", "spexr-git-sync"]);
  });

  it("removes the sync item when the upstream goes, and every entry when the status does", () => {
    const b = bar();
    applyGitEntries(b, planGitEntries(status, "ok"), make);
    applyGitEntries(b, planGitEntries({ branch: "main", ahead: 2, behind: 0 }, "ok"), make);
    expect([...b.held.keys()]).toEqual(["spexr-git-branch", "spexr-git-divergence"]);
    applyGitEntries(b, planGitEntries(undefined, "ok"), make);
    expect(b.held.size).toBe(0);
  });

  it("says commits behind once: in the sync item, not in the branch's pills", () => {
    const entries = planGitEntries({ ...status, ahead: 0, behind: 3 }, "ok");
    expect(entries.sync?.text).toBe("$(sync) ↓3 to pull");
    expect(entries.divergence).toBeUndefined();
    expect(entries.branch?.text).toBe("$(git-branch) main");
  });

  it("shows a failed fetch in the sync item", () => {
    expect(planGitEntries(status, "failed").sync?.text).toBe("$(warning) fetch failed");
  });
});

describe("formatSyncEntry (S6d, S3, D16)", () => {
  const up = "origin/main";

  it("says synced with nothing to pull and a fetch that worked", () => {
    expect(formatSyncEntry({ upstream: up, behind: 0, outcome: "ok" })?.text).toBe("$(sync) synced");
  });

  it("says how many commits to pull", () => {
    expect(formatSyncEntry({ upstream: up, behind: 3, outcome: "ok" })?.text).toBe("$(sync) ↓3 to pull");
    expect(formatSyncEntry({ upstream: up, behind: 1, outcome: "ok" })?.tooltip).toContain("1 commit to pull");
    expect(formatSyncEntry({ upstream: up, behind: 2, outcome: "ok" })?.tooltip).toContain("2 commits to pull");
  });

  it("says a fetch failed first, with the count it left when that is known", () => {
    expect(formatSyncEntry({ upstream: up, behind: 0, outcome: "failed" })?.text).toBe("$(warning) fetch failed");
    expect(formatSyncEntry({ upstream: up, behind: 4, outcome: "failed" })?.text).toBe("$(warning) fetch failed · ↓4");
    expect(formatSyncEntry({ upstream: up, behind: 4, outcome: "failed" })?.label).toContain("4 commits to pull as of the last good fetch");
  });

  it("claims nothing more than the tracking branch before a fetch and after a branch switch", () => {
    const entry = formatSyncEntry({ upstream: up, behind: 0, outcome: "unknown" });
    expect(entry?.text).toBe("$(sync) synced");
    expect(entry?.tooltip).toContain("not fetched yet");
    expect(formatSyncEntry({ upstream: up, behind: 2, outcome: "unknown" })?.text).toBe("$(sync) ↓2 to pull");
  });

  it("is no item on a branch with no upstream", () => {
    expect(formatSyncEntry({ behind: 0, outcome: "ok" })).toBeUndefined();
    expect(formatSyncEntry({ behind: 0, outcome: "failed" })).toBeUndefined();
  });

  it("gives each state a name for a screen reader that says the click", () => {
    for (const state of [{ behind: 0, outcome: "ok" }, { behind: 2, outcome: "ok" }, { behind: 0, outcome: "failed" }]) {
      expect(formatSyncEntry({ upstream: up, ...state })?.label).toMatch(/click to (fetch|try again)/);
    }
  });
});
