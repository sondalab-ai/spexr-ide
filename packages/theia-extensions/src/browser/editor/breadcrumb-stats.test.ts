import { describe, expect, it } from "vitest";
import { BreadcrumbStats, type StatsDeps } from "./breadcrumb-stats.js";

/** A stats object over fakes: `heads` is HEAD's text per path, `reads` counts the git reads, `sig` the head signature. */
function make(over: Partial<StatsDeps> = {}) {
  const state = { reads: 0, sig: "s1", heads: new Map<string, string>([["a.ts", "one\ntwo\n"]]) };
  const deps: StatsDeps = {
    roots: () => ["/repo"],
    signature: async () => state.sig,
    readHead: async (_root, rel) => {
      state.reads++;
      const text = state.heads.get(rel);
      if (text === undefined) throw new Error(`fatal: path '${rel}' exists on disk, but not in 'HEAD'`);
      return text;
    },
    diff: (previous, current) => ({ added: current.split("\n").length, removed: previous.split("\n").length }),
    ...over,
  };
  return { stats: new BreadcrumbStats(deps), state };
}

describe("the breadcrumb stats (E7)", () => {
  it("reads HEAD once per file until the head signature changes, however often the text is read again", async () => {
    const { stats, state } = make();
    await stats.refresh("file:///repo/a.ts", "/repo/a.ts", "one\nTWO\n");
    await stats.refresh("file:///repo/a.ts", "/repo/a.ts", "one\nTWO\nthree\n");
    await stats.refresh("file:///repo/a.ts", "/repo/a.ts", "x");
    expect(state.reads).toBe(1);
    state.sig = "s2";
    state.heads.set("a.ts", "new head\n");
    await stats.refresh("file:///repo/a.ts", "/repo/a.ts", "x");
    expect(state.reads).toBe(2);
  });

  it("does not diff again for the same signature and text, as repeated status events ask", async () => {
    let diffs = 0;
    const { stats, state } = make({ diff: () => (diffs++, { added: 1, removed: 0 }) });
    await stats.refresh("u", "/repo/a.ts", "same text");
    await stats.refresh("u", "/repo/a.ts", "same text");
    await stats.refresh("u", "/repo/a.ts", "same text");
    expect(diffs).toBe(1);
    await stats.refresh("u", "/repo/a.ts", "edited text");
    expect(diffs).toBe(2);
    state.sig = "s2";
    await stats.refresh("u", "/repo/a.ts", "edited text");
    expect(diffs).toBe(3);
  });

  it("reports whether the stat changed", async () => {
    const { stats } = make();
    expect(await stats.refresh("u", "/repo/a.ts", "a\nb")).toBe(true);
    expect(await stats.refresh("u", "/repo/a.ts", "a\nb")).toBe(false);
    expect(await stats.refresh("u", "/repo/a.ts", "a\nb\nc")).toBe(true);
  });

  it("drops a read that a newer one overtook, so a stale answer never overwrites a newer one", async () => {
    let release!: (text: string) => void;
    const slow = new Promise<string>((resolve) => (release = resolve));
    let calls = 0;
    const { stats } = make({
      readHead: () => (++calls === 1 ? slow : Promise.resolve("fresh head")),
      signature: async () => `call-${calls}`,
      diff: (previous) => ({ added: previous === "fresh head" ? 1 : 99, removed: 0 }),
    });
    const first = stats.refresh("u", "/repo/a.ts", "x");
    await new Promise((resolve) => setTimeout(resolve, 0)); // the first is now waiting on HEAD
    const second = stats.refresh("u", "/repo/a.ts", "x");
    expect(await second).toBe(true);
    release("old head");
    expect(await first).toBe(false);
    expect(stats.get("u")).toEqual({ added: 1, removed: 0 });
  });

  it("counts a file that is not in HEAD as all added", async () => {
    const { stats } = make();
    await stats.refresh("u", "/repo/new.ts", "a\nb\nc");
    expect(stats.get("u")).toEqual({ added: 3, removed: 1 });
  });

  it("leaves the stat unset on any other failure, and reads again next time", async () => {
    let calls = 0;
    const { stats } = make({
      readHead: async () => {
        calls++;
        throw new Error("spawn git ENOENT");
      },
    });
    await stats.refresh("u", "/repo/a.ts", "x");
    expect(stats.get("u")).toBeUndefined();
    await stats.refresh("u", "/repo/a.ts", "x");
    expect(calls).toBe(2);
  });

  it("has no stat for a file outside every repository, and for a difference over the budget", async () => {
    const { stats } = make({ diff: () => undefined });
    await stats.refresh("out", "/elsewhere/a.ts", "x");
    expect(stats.get("out")).toBeUndefined();
    await stats.refresh("big", "/repo/a.ts", "x");
    expect(stats.get("big")).toBeUndefined();
  });

  it("forgets a file's HEAD text and stat when its last editor goes", async () => {
    const { stats, state } = make();
    await stats.refresh("u", "/repo/a.ts", "x");
    stats.forget("u");
    expect(stats.get("u")).toBeUndefined();
    await stats.refresh("u", "/repo/a.ts", "x");
    expect(state.reads).toBe(2);
  });

  it("finds a nested repository's file by the longest root", async () => {
    const seen: string[] = [];
    const { stats } = make({ roots: () => ["/repo", "/repo/sub"], readHead: async (root, rel) => { seen.push(`${root}:${rel}`); return "h"; } });
    await stats.refresh("u", "/repo/sub/b.ts", "x");
    expect(seen).toEqual(["/repo/sub:b.ts"]);
  });
});
