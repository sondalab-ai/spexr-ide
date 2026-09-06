import { describe, expect, it } from "vitest";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import {
  addTrashed,
  partitionTrashed,
  readTrashed,
  removeTrashed,
  writeTrashed,
  TRASH_CAP,
  TRASH_KEY,
  type TrashStorage,
} from "./trash.js";

function fakeStorage(initial?: string): TrashStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem() {
      return this.value;
    },
    setItem(_key: string, v: string) {
      this.value = v;
    },
  };
}

function tile(sessionId: string, projectPath = "/p"): AgentTile {
  return {
    sessionId,
    harness: "claude",
    transcriptPath: `/t/${sessionId}.jsonl`,
    projectPath,
    projectName: projectPath.split("/").pop() ?? projectPath,
    state: "idle",
    needsYou: false,
    needsYouCertain: true,
    lastFailed: false,
    goal: "",
    actionLine: "",
    recentActions: [],
    lastActivityMs: 0,
    turnCount: 1,
    accentId: 0,
  };
}

describe("readTrashed", () => {
  it("is empty when nothing is stored", () => {
    expect(readTrashed(fakeStorage())).toEqual([]);
  });

  it("returns the stored ids in order", () => {
    expect(readTrashed(fakeStorage(JSON.stringify(["a", "b"])))).toEqual(["a", "b"]);
  });

  it("ignores a value that is not JSON", () => {
    expect(readTrashed(fakeStorage("{nope"))).toEqual([]);
  });

  it("ignores JSON that is not an array", () => {
    expect(readTrashed(fakeStorage(JSON.stringify({ a: 1 })))).toEqual([]);
  });

  it("drops entries that are not non-empty strings", () => {
    expect(readTrashed(fakeStorage(JSON.stringify(["a", 3, null, "", "b"])))).toEqual(["a", "b"]);
  });

  it("keeps only the newest entries when the stored list is over the cap", () => {
    const stored = Array.from({ length: TRASH_CAP + 5 }, (_, i) => `s${i}`);
    const read = readTrashed(fakeStorage(JSON.stringify(stored)));
    expect(read).toHaveLength(TRASH_CAP);
    expect(read[0]).toBe("s5");
  });

  it("survives storage that throws", () => {
    const throwing: TrashStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        /* unused */
      },
    };
    expect(readTrashed(throwing)).toEqual([]);
  });
});

describe("writeTrashed", () => {
  it("round-trips through storage", () => {
    const storage = fakeStorage();
    writeTrashed(storage, ["a", "b"]);
    expect(storage.value).toBe(JSON.stringify(["a", "b"]));
    expect(readTrashed(storage)).toEqual(["a", "b"]);
  });

  it("writes under the shared key", () => {
    const keys: string[] = [];
    writeTrashed(
      {
        getItem: () => null,
        setItem: (key) => {
          keys.push(key);
        },
      },
      ["a"],
    );
    expect(keys).toEqual([TRASH_KEY]);
  });

  it("evicts the oldest entries past the cap", () => {
    const storage = fakeStorage();
    writeTrashed(
      storage,
      Array.from({ length: TRASH_CAP + 2 }, (_, i) => `s${i}`),
    );
    const read = readTrashed(storage);
    expect(read).toHaveLength(TRASH_CAP);
    expect(read[0]).toBe("s2");
    expect(read[read.length - 1]).toBe(`s${TRASH_CAP + 1}`);
  });

  it("survives storage that throws", () => {
    expect(() =>
      writeTrashed(
        {
          getItem: () => null,
          setItem() {
            throw new Error("quota");
          },
        },
        ["a"],
      ),
    ).not.toThrow();
  });
});

describe("addTrashed", () => {
  it("appends the session as the newest entry", () => {
    expect(addTrashed(["a"], "b")).toEqual(["a", "b"]);
  });

  it("moves an already trashed session to the end rather than duplicating it", () => {
    expect(addTrashed(["a", "b"], "a")).toEqual(["b", "a"]);
  });

  it("drops the oldest entry once the cap is reached", () => {
    const full = Array.from({ length: TRASH_CAP }, (_, i) => `s${i}`);
    const next = addTrashed(full, "new");
    expect(next).toHaveLength(TRASH_CAP);
    expect(next).not.toContain("s0");
    expect(next[next.length - 1]).toBe("new");
  });
});

describe("removeTrashed", () => {
  it("takes the session back out", () => {
    expect(removeTrashed(["a", "b"], "a")).toEqual(["b"]);
  });

  it("leaves the list alone when the session is not trashed", () => {
    expect(removeTrashed(["a"], "z")).toEqual(["a"]);
  });
});

describe("partitionTrashed", () => {
  it("splits the tiles, keeping each side in the given order", () => {
    const tiles = [tile("a"), tile("b"), tile("c")];
    const { kept, discarded } = partitionTrashed(tiles, new Set(["b"]));
    expect(kept.map((t) => t.sessionId)).toEqual(["a", "c"]);
    expect(discarded.map((t) => t.sessionId)).toEqual(["b"]);
  });

  it("keeps every tile when nothing is trashed", () => {
    const tiles = [tile("a")];
    expect(partitionTrashed(tiles, new Set()).kept).toEqual(tiles);
  });

  it("ignores trashed ids that have no tile on the wall", () => {
    // A trashed session slides out of the scan window; the id stays remembered
    // so the session is still trashed if it ever comes back.
    const { kept, discarded } = partitionTrashed([tile("a")], new Set(["gone", "a"]));
    expect(kept).toEqual([]);
    expect(discarded.map((t) => t.sessionId)).toEqual(["a"]);
  });
});
