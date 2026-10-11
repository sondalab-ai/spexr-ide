import { describe, expect, it } from "vitest";
import { diffStats } from "./diff-stats.js";

describe("the lines a file differs by (E7)", () => {
  it("counts an added run and a removed run", () => {
    expect(diffStats("a\nb\nc\n", "a\nb\nc\nd\ne\n")).toEqual({ added: 2, removed: 0 });
    expect(diffStats("a\nb\nc\nd\n", "a\nd\n")).toEqual({ added: 0, removed: 2 });
  });

  it("counts a changed line once on each side, and an identical file as nothing", () => {
    expect(diffStats("a\nb\nc\n", "a\nB\nc\n")).toEqual({ added: 1, removed: 1 });
    expect(diffStats("a\nb\n", "a\nb\n")).toEqual({ added: 0, removed: 0 });
  });

  it("reads a file with no committed revision as all added", () => {
    expect(diffStats("", "a\nb\nc")).toEqual({ added: 3, removed: 0 });
  });
});
