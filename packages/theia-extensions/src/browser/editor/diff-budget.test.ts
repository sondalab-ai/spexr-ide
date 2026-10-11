import { describe, expect, it } from "vitest";
import { DIFF_BUDGET, headSignature, isNotInHead, linesOf, planDiff, repoRootFor, stripBom, trimCommon, withinBudget } from "./diff-budget.js";

const lines = (n: number, tag = "x"): string => Array.from({ length: n }, (_, i) => `${tag}${i}`).join("\n");

describe("the diff budget (E7)", () => {
  it("cuts the lines the texts share at their ends, which changes no count", () => {
    expect(trimCommon(["a", "b", "c", "d"], ["a", "X", "c", "d"])).toEqual({ previous: ["b"], current: ["X"] });
    expect(trimCommon(["a", "a"], ["a", "a", "a"])).toEqual({ previous: [], current: ["a"] });
    expect(trimCommon([], [])).toEqual({ previous: [], current: [] });
  });

  it("answers identical texts, and added-only or removed-only edits, without a diff", () => {
    expect(planDiff("a\nb", "a\nb")).toEqual({ kind: "stats", stats: { added: 0, removed: 0 } });
    expect(planDiff("a\nb\n", "a\nb\nc\nd\n")).toEqual({ kind: "stats", stats: { added: 2, removed: 0 } });
    expect(planDiff("a\nb\nc", "a\nc")).toEqual({ kind: "stats", stats: { added: 0, removed: 1 } });
    expect(planDiff("", lines(3000))).toEqual({ kind: "stats", stats: { added: 3000, removed: 0 } });
  });

  it("diffs only the region that differs, so a one-line edit in a long file is cheap", () => {
    const head = lines(10_000);
    const edited = head.replace("x5000\n", "CHANGED\n");
    expect(planDiff(head, edited)).toEqual({ kind: "diff", previous: "x5000", current: "CHANGED" });
  });

  it("skips a rewrite over the line budget, which would block the UI thread", () => {
    expect(planDiff(lines(DIFF_BUDGET.maxLines + 1, "a"), lines(DIFF_BUDGET.maxLines + 1, "b"))).toEqual({ kind: "skip" });
    expect(planDiff(lines(DIFF_BUDGET.maxLines, "a"), lines(DIFF_BUDGET.maxLines, "b")).kind).toBe("diff");
  });

  it("skips a region over the character budget, and one whose sides are hugely lopsided", () => {
    const wide = "w".repeat(DIFF_BUDGET.maxChars + 1);
    expect(withinBudget([wide], ["a"])).toBe(false);
    expect(withinBudget(["a"], ["b"])).toBe(true);
    expect(withinBudget(Array(1000).fill("a"), ["b"])).toBe(false);
    expect(withinBudget(Array(150).fill("a"), ["b"])).toBe(true);
  });

  it("reads a byte order mark and CRLF line ends as nothing", () => {
    expect(stripBom("\ufeffa")).toBe("a");
    expect(linesOf("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
    expect(linesOf("a\nb\n")).toEqual(["a", "b"]);
    expect(linesOf("")).toEqual([]);
    expect(planDiff("\ufeffa\r\nb", "a\nb")).toEqual({ kind: "stats", stats: { added: 0, removed: 0 } });
  });
});

describe("git's refusal to show a path", () => {
  it("is 'new' only when the file is not in HEAD", () => {
    expect(isNotInHead(new Error("fatal: path 'x.ts' exists on disk, but not in 'HEAD'"))).toBe(true);
    expect(isNotInHead(new Error("fatal: path 'x.ts' does not exist in 'HEAD'"))).toBe(true);
    expect(isNotInHead(new Error("fatal: invalid object name 'HEAD'."))).toBe(true);
  });

  it("is a failure for anything else", () => {
    expect(isNotInHead(new Error("spawn git ENOENT"))).toBe(false);
    expect(isNotInHead(new Error("fatal: not a git repository"))).toBe(false);
    expect(isNotInHead("timeout")).toBe(false);
  });
});

describe("the repository holding a file", () => {
  it("is the longest root it lies under, so a nested repository wins over its parent", () => {
    expect(repoRootFor("/w/app/sub/a.ts", ["/w/app", "/w/app/sub"])).toBe("/w/app/sub");
    expect(repoRootFor("/w/app/a.ts", ["/w/app/sub", "/w/app"])).toBe("/w/app");
  });

  it("never claims a sibling with the same prefix, and finds nothing outside every root", () => {
    expect(repoRootFor("/w/app-2/a.ts", ["/w/app"])).toBeUndefined();
    expect(repoRootFor("/elsewhere/a.ts", ["/w/app"])).toBeUndefined();
  });

  it("compares Windows and URI paths alike, and ignores a trailing slash", () => {
    expect(repoRootFor("C:\\w\\app\\a.ts", ["C:/w/app/"])).toBe("C:/w/app/");
    expect(repoRootFor("c:/w/app/a.ts", ["c:\\w\\app"])).toBe("c:\\w\\app");
  });
});

describe("the head signature", () => {
  const status = (over: Partial<{ branch: string; ahead: number; behind: number; files: Array<{ path: string; stagedState?: string; unstagedState?: string }> }> = {}) => ({
    branch: "main",
    ahead: 0,
    behind: 0,
    files: [],
    ...over,
  });

  it("changes with a commit (the file leaves the status, ahead moves), a checkout and a pull", () => {
    const base = headSignature(status({ ahead: 1, files: [{ path: "a.ts", unstagedState: "M" }] }), "a.ts");
    expect(headSignature(status({ ahead: 2 }), "a.ts")).not.toBe(base);
    expect(headSignature(status({ branch: "dev", ahead: 1, files: [{ path: "a.ts", unstagedState: "M" }] }), "a.ts")).not.toBe(base);
    expect(headSignature(status({ ahead: 1, behind: 3, files: [{ path: "a.ts", unstagedState: "M" }] }), "a.ts")).not.toBe(base);
  });

  it("stays the same for a change to another file", () => {
    const a = headSignature(status({ files: [{ path: "a.ts", unstagedState: "M" }] }), "a.ts");
    const b = headSignature(status({ files: [{ path: "a.ts", unstagedState: "M" }, { path: "other.ts", unstagedState: "M" }] }), "a.ts");
    expect(a).toBe(b);
    expect(headSignature(undefined, "a.ts")).toBe("none");
  });
});
