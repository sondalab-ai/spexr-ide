import { describe, expect, it } from "vitest";
import { containingRoot, distinctRepoRoots, locateInRepo } from "./git-repo-roots.js";

describe("distinctRepoRoots", () => {
  it("keeps one entry per repository across several workspace folders", () => {
    expect(
      distinctRepoRoots([
        { root: "/w/alpha", toplevel: "/w/alpha" },
        { root: "/w/beta", toplevel: "/w/beta" },
      ]),
    ).toEqual(["/w/alpha", "/w/beta"]);
  });

  it("collapses folders of the same repository, including a nested subfolder", () => {
    // The regression: only the first workspace folder used to get a provider,
    // and a folder nested in an already-listed repository must not add a second.
    expect(
      distinctRepoRoots([
        { root: "/w/repo/packages/a", toplevel: "/w/repo" },
        { root: "/w/repo/packages/b", toplevel: "/w/repo" },
        { root: "/w/other", toplevel: "/w/other" },
      ]),
    ).toEqual(["/w/repo", "/w/other"]);
  });

  it("drops folders that are not inside a repository", () => {
    expect(
      distinctRepoRoots([
        { root: "/w/notes", toplevel: undefined },
        { root: "/w/repo", toplevel: "/w/repo" },
      ]),
    ).toEqual(["/w/repo"]);
  });

  it("returns nothing for an empty workspace or an all-non-repository one", () => {
    expect(distinctRepoRoots([])).toEqual([]);
    expect(distinctRepoRoots([{ root: "/w/notes", toplevel: undefined }])).toEqual([]);
  });
});

describe("containingRoot", () => {
  it("finds the root a path belongs to", () => {
    expect(containingRoot(["/w/alpha", "/w/beta"], "/w/beta/src/app.ts")).toBe("/w/beta");
  });

  it("prefers the deepest root when they nest", () => {
    expect(containingRoot(["/w/repo", "/w/repo/vendor"], "/w/repo/vendor/lib.ts")).toBe(
      "/w/repo/vendor",
    );
    expect(containingRoot(["/w/repo", "/w/repo/vendor"], "/w/repo/src/lib.ts")).toBe("/w/repo");
  });

  it("counts the root itself as contained and tolerates a trailing separator", () => {
    expect(containingRoot(["/w/alpha"], "/w/alpha")).toBe("/w/alpha");
    expect(containingRoot(["/w/alpha/"], "/w/alpha/src")).toBe("/w/alpha");
  });

  it("does not match a sibling sharing a name prefix", () => {
    expect(containingRoot(["/w/repo"], "/w/repo-other/src/app.ts")).toBeUndefined();
  });

  it("returns undefined when no root contains the path", () => {
    expect(containingRoot([], "/w/alpha/x")).toBeUndefined();
    expect(containingRoot(["/w/alpha"], "/elsewhere/x")).toBeUndefined();
  });
});

describe("locateInRepo", () => {
  it("relativizes a file against the repository that contains it", () => {
    // The blame regression: with two repositories open, a file in the second
    // used to be relativized against the first and never resolved at all.
    expect(locateInRepo(["/w/alpha", "/w/beta"], "/w/beta/src/app.ts")).toEqual({
      root: "/w/beta",
      relPath: "src/app.ts",
    });
  });

  it("uses the deepest repository when they nest", () => {
    expect(locateInRepo(["/w/repo", "/w/repo/vendor"], "/w/repo/vendor/lib.ts")).toEqual({
      root: "/w/repo/vendor",
      relPath: "lib.ts",
    });
  });

  it("returns undefined for a repository root itself", () => {
    expect(locateInRepo(["/w/alpha"], "/w/alpha")).toBeUndefined();
  });

  it("returns undefined for a path outside every repository", () => {
    expect(locateInRepo(["/w/alpha"], "/elsewhere/app.ts")).toBeUndefined();
    expect(locateInRepo([], "/w/alpha/app.ts")).toBeUndefined();
  });
});
