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
});
