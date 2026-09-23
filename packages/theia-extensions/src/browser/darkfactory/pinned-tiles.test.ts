import { describe, expect, it } from "vitest";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { keepPinnedTiles } from "./pinned-tiles.js";

const tile = (sessionId: string, lastActivityMs = 0): AgentTile =>
  ({ sessionId, projectPath: "/p", lastActivityMs }) as AgentTile;

describe("keepPinnedTiles", () => {
  it("keeps a pinned session the latest scan left out", () => {
    // An idle pinned session slides past the scan's recent-sessions cut once
    // enough other transcripts are written after it.
    const previous = [tile("pinned"), tile("other")];
    const merged = keepPinnedTiles([tile("other")], previous, ["pinned"]);
    expect(merged.map((t) => t.sessionId)).toEqual(["other", "pinned"]);
  });

  it("prefers the fresh tile when the scan still has the session", () => {
    const merged = keepPinnedTiles([tile("pinned", 2)], [tile("pinned", 1)], ["pinned"]);
    expect(merged).toEqual([tile("pinned", 2)]);
  });

  it("lets an unpinned session leave the wall with the scan", () => {
    const merged = keepPinnedTiles([], [tile("gone")], []);
    expect(merged).toEqual([]);
  });

  it("returns the scan untouched when nothing needs carrying", () => {
    const fresh = [tile("a")];
    expect(keepPinnedTiles(fresh, [tile("a")], ["a"])).toBe(fresh);
  });
});
