import { describe, it, expect } from "vitest";
import type { GitStatusDto } from "../../common/git-protocol.js";
import { sameIgnoreListings, sameStatus } from "./status-equality.js";

const base: GitStatusDto = {
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  files: [{ path: "a.ts", unstagedState: "M" }],
  isClean: false,
  mergeInProgress: false,
};

describe("sameStatus", () => {
  it("is false when there is no previous status", () => {
    expect(sameStatus(undefined, base)).toBe(false);
  });
  it("is true for an identical status from a fresh object", () => {
    expect(sameStatus(base, { ...base, files: [{ path: "a.ts", unstagedState: "M" }] })).toBe(true);
  });
  it("is false when a file changes state", () => {
    expect(sameStatus(base, { ...base, files: [{ path: "a.ts", stagedState: "M" }] })).toBe(false);
  });
  it("is false when a file appears", () => {
    expect(sameStatus(base, { ...base, files: [...base.files, { path: "b.ts", unstagedState: "?" }] })).toBe(false);
  });
  it("is false when only ahead/behind moves", () => {
    expect(sameStatus(base, { ...base, behind: 2 })).toBe(false);
  });
  it("is false when the branch changes", () => {
    expect(sameStatus(base, { ...base, branch: "feat" })).toBe(false);
  });
  it("is false when a merge starts", () => {
    expect(sameStatus(base, { ...base, mergeInProgress: true })).toBe(false);
  });
});

describe("sameIgnoreListings", () => {
  const listing = [{ root: "/w/a", paths: ["dist/"] }, { root: "/w/b", paths: [] }];
  it("is false when there is no previous listing", () => {
    expect(sameIgnoreListings(undefined, listing)).toBe(false);
  });
  it("is true for the same listings from fresh objects", () => {
    expect(sameIgnoreListings(listing, [{ root: "/w/a", paths: ["dist/"] }, { root: "/w/b", paths: [] }])).toBe(true);
  });
  it("is false when a folder gains an ignored path", () => {
    expect(sameIgnoreListings(listing, [{ root: "/w/a", paths: ["dist/", "out/"] }, { root: "/w/b", paths: [] }])).toBe(false);
  });
  it("is false when a folder is added to the workspace", () => {
    expect(sameIgnoreListings(listing, [...listing, { root: "/w/c", paths: [] }])).toBe(false);
  });
});
