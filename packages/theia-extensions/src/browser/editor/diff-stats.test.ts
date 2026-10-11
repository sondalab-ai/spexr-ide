import { describe, expect, it } from "vitest";
import { diffStats } from "./diff-stats.js";

/** A reference line diff: the longest common subsequence, then added = current - common, removed = previous - common (`git diff --numstat`'s counts). */
function reference(previous: string, current: string): { added: number; removed: number } {
  const split = (t: string): string[] => (t === "" ? [] : t.replace(/\n$/, "").split("\n"));
  const a = split(previous);
  const b = split(current);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const common = table[0]![0]!;
  return { added: b.length - common, removed: a.length - common };
}

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

  it("counts a changed region that starts or ends at a blank line as a change: +1 -1, not a pure add or remove", () => {
    expect(diffStats("a\n\nb\n", "a\nX\nb\n")).toEqual({ added: 1, removed: 1 });
    expect(diffStats("a\nX\nb\n", "a\n\nb\n")).toEqual({ added: 1, removed: 1 });
    expect(diffStats("x\n\n", "x\ny\n\n")).toEqual({ added: 1, removed: 0 });
    expect(diffStats("a\n\n\nb\n", "a\nQ\n\nb\n")).toEqual({ added: 1, removed: 1 });
  });

  it("agrees with a reference line diff on seeded random edits, blank lines included", () => {
    let seed = 12345;
    const rand = (n: number): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed % n;
    };
    const alphabet = ["", "", "a", "b", "c", "d", "e"];
    const text = (n: number): string => Array.from({ length: n }, () => alphabet[rand(alphabet.length)]!).join("\n") + "\n";
    for (let i = 0; i < 1500; i++) {
      const previous = text(rand(12));
      const edited = previous.split("\n");
      for (let k = rand(4); k > 0; k--) {
        const at = rand(edited.length + 1);
        if (rand(2)) edited.splice(at, rand(3), ...Array.from({ length: rand(3) }, () => alphabet[rand(alphabet.length)]!));
        else edited.splice(at, rand(3));
      }
      const current = edited.join("\n");
      expect(diffStats(previous, current), JSON.stringify({ previous, current })).toEqual(reference(previous, current));
    }
  });

  it("is nothing for a rewrite over the budget, and cheap for a one-line edit in a long file", () => {
    const rows = (n: number, tag: string): string => Array.from({ length: n }, (_, i) => `${tag}${i}`).join("\n");
    const started = Date.now();
    expect(diffStats(rows(5000, "a"), rows(5000, "b"))).toBeUndefined();
    const long = rows(10_000, "x");
    expect(diffStats(long, long.replace("x5000\n", "changed\n"))).toEqual({ added: 1, removed: 1 });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
