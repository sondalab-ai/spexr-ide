import { describe, it, expect } from "vitest";
import { toRepoRelative } from "./relative-path.js";

describe("toRepoRelative", () => {
  it("strips the root prefix", () => {
    expect(toRepoRelative("/w/repo", "/w/repo/src/a.ts")).toBe("src/a.ts");
  });
  it("leaves an already-relative path alone", () => {
    expect(toRepoRelative("/w/repo", "src/a.ts")).toBe("src/a.ts");
  });
  it("handles the root itself", () => {
    expect(toRepoRelative("/w/repo", "/w/repo")).toBe("");
  });
  it("does not strip a sibling directory that merely shares a prefix", () => {
    expect(toRepoRelative("/w/repo", "/w/repo-other/a.ts")).toBe("/w/repo-other/a.ts");
  });
  it("handles the root itself when root carries a trailing slash", () => {
    expect(toRepoRelative("/w/repo/", "/w/repo")).toBe("");
  });
  it("strips a trailing-slash root from a nested path", () => {
    expect(toRepoRelative("/w/repo/", "/w/repo/src/a.ts")).toBe("src/a.ts");
  });

  const underRootCases: Array<[string, string]> = [
    ["/w/repo", "/w/repo/src/a.ts"],
    ["/w/repo", "/w/repo"],
    ["/w/repo/", "/w/repo"],
    ["/w/repo/", "/w/repo/src/a.ts"],
  ];
  it("never returns an absolute path for input genuinely under the root", () => {
    for (const [root, fsPath] of underRootCases) {
      expect(toRepoRelative(root, fsPath).startsWith("/")).toBe(false);
    }
  });
});
