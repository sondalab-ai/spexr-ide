import { describe, expect, it } from "vitest";
import { chooseSuccessor } from "./agent-successor.js";

const cur = { sessionId: "old", lastAtMs: 1000, rootUuid: "r-old" };

describe("chooseSuccessor", () => {
  it("follows a resume: the lineage names the transcript that took over", () => {
    expect(chooseSuccessor(cur, new Map([["old", "copy"]]), [{ sessionId: "copy", mtimeMs: 5 }])).toBe("copy");
  });

  it("follows a /clear: the first transcript that began after the old one last wrote", () => {
    const picked = chooseSuccessor(cur, new Map(), [
      { sessionId: "later", mtimeMs: 9, firstAtMs: 3000, rootUuid: "r3" },
      { sessionId: "next", mtimeMs: 7, firstAtMs: 1500, rootUuid: "r2" },
      { sessionId: "before", mtimeMs: 6, firstAtMs: 500, rootUuid: "r1" },
    ]);
    expect(picked).toBe("next");
  });

  it("does not take a transcript that shares the old one's conversation without the lineage saying so", () => {
    expect(chooseSuccessor(cur, new Map(), [{ sessionId: "same", mtimeMs: 9, firstAtMs: 2000, rootUuid: "r-old" }])).toBeUndefined();
  });

  it("stays when nothing is newer, when the old one has no time, or the candidate has none", () => {
    expect(chooseSuccessor(cur, new Map(), [])).toBeUndefined();
    expect(chooseSuccessor({ sessionId: "old" }, new Map(), [{ sessionId: "n", mtimeMs: 9, firstAtMs: 2000 }])).toBeUndefined();
    expect(chooseSuccessor(cur, new Map(), [{ sessionId: "n", mtimeMs: 9 }])).toBeUndefined();
  });

  it("never names itself", () => {
    expect(chooseSuccessor(cur, new Map([["old", "old"]]), [{ sessionId: "old", mtimeMs: 9, firstAtMs: 2000 }])).toBeUndefined();
  });
});
