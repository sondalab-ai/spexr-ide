import { describe, it, expect } from "vitest";
import { touchesRepository } from "./repository-change-scope.js";

describe("touchesRepository", () => {
  it("is true for a file inside the repository", () => {
    expect(touchesRepository("/w/repo", ["/w/repo/src/a.ts"])).toBe(true);
  });
  it("is false for a file in another repository", () => {
    expect(touchesRepository("/w/repo", ["/w/other/src/a.ts"])).toBe(false);
  });
  it("is false for a sibling that merely shares a prefix", () => {
    expect(touchesRepository("/w/repo", ["/w/repo-other/a.ts"])).toBe(false);
  });
  it("ignores the git dir, which the backend watches itself", () => {
    expect(touchesRepository("/w/repo", ["/w/repo/.git/index.lock", "/w/repo/.git"])).toBe(false);
  });
  it("still counts a file whose name only starts with .git", () => {
    expect(touchesRepository("/w/repo", ["/w/repo/.gitignore"])).toBe(true);
  });
  it("is true when any path of a mixed batch is inside", () => {
    expect(touchesRepository("/w/repo", ["/w/other/a", "/w/repo/b"])).toBe(true);
  });
  it("accepts a root with a trailing slash", () => {
    expect(touchesRepository("/w/repo/", ["/w/repo/a"])).toBe(true);
  });
  it("counts the root itself, e.g. the folder being deleted", () => {
    expect(touchesRepository("/w/repo", ["/w/repo"])).toBe(true);
  });
});
