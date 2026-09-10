import { describe, expect, it } from "vitest";
import { staleProjectNames, staleSessionNames } from "./stale-names.js";

const names = (...ids: string[]) => new Map(ids.map((id) => [id, `name of ${id}`]));

describe("staleSessionNames", () => {
  it("keeps a name whose session the scan still finds", () => {
    const out = staleSessionNames(names("a"), new Set(["a"]), new Set());
    expect(out.drop).toEqual([]);
    expect([...out.missingNow]).toEqual([]);
  });

  it("waits for a second scan before dropping a name", () => {
    const first = staleSessionNames(names("a", "b"), new Set(["a"]), new Set());
    expect(first.drop).toEqual([]);
    expect([...first.missingNow]).toEqual(["b"]);

    const second = staleSessionNames(names("a", "b"), new Set(["a"]), first.missingNow);
    expect(second.drop).toEqual(["b"]);
  });

  it("forgets a session that came back, so a flaky scan costs nothing", () => {
    const first = staleSessionNames(names("a", "b"), new Set(["a"]), new Set());
    const second = staleSessionNames(names("a", "b"), new Set(["a", "b"]), first.missingNow);
    expect(second.drop).toEqual([]);
    expect([...second.missingNow]).toEqual([]);
  });

  it("drops nothing when the scan found no sessions at all", () => {
    const missing = new Set(["a", "b"]);
    expect(staleSessionNames(names("a", "b"), new Set(), missing).drop).toEqual([]);
  });

  it("drops the only name it holds, which the share guard alone would forbid", () => {
    const missing = new Set(["a"]);
    expect(staleSessionNames(names("a"), new Set(["b"]), missing).drop).toEqual(["a"]);
  });

  it("drops nothing when most of the stored names would go at once", () => {
    const stored = names("a", "b", "c", "d", "e", "f");
    const missing = new Set(["b", "c", "d", "e", "f"]);
    expect(staleSessionNames(stored, new Set(["a"]), missing).drop).toEqual([]);
  });

  it("still drops a run of deletions that stays under half", () => {
    const stored = names("a", "b", "c", "d", "e", "f");
    const missing = new Set(["d", "e", "f"]);
    expect(staleSessionNames(stored, new Set(["a", "b", "c"]), missing).drop).toEqual([
      "d",
      "e",
      "f",
    ]);
  });
});

describe("staleProjectNames", () => {
  const gone = { exists: false, parentExists: true };
  const alive = { exists: true, parentExists: true };
  const unreachable = { exists: false, parentExists: false };

  it("drops a name whose project directory was deleted", () => {
    expect(staleProjectNames(names("/a", "/b"), new Map([["/a", alive], ["/b", gone]]))).toEqual([
      "/b",
    ]);
  });

  it("keeps a name whose whole parent is unreachable, as an unplugged volume is", () => {
    expect(
      staleProjectNames(names("/a", "/vol/b"), new Map([["/a", alive], ["/vol/b", unreachable]])),
    ).toEqual([]);
  });

  it("keeps a name the caller could not check at all", () => {
    expect(staleProjectNames(names("/a"), new Map())).toEqual([]);
  });

  it("drops nothing when most of the stored names would go at once", () => {
    const state = new Map([
      ["/a", alive],
      ["/b", gone],
      ["/c", gone],
      ["/d", gone],
      ["/e", gone],
    ]);
    expect(staleProjectNames(names("/a", "/b", "/c", "/d", "/e"), state)).toEqual([]);
  });

  it("keeps a project alive on disk even when no session is left on the wall", () => {
    expect(staleProjectNames(names("/a"), new Map([["/a", alive]]))).toEqual([]);
  });
});
