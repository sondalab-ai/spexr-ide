import { describe, expect, it } from "vitest";
import {
  SessionIndex,
  SESSION_INDEX_VERSION,
  indexedText,
  type SessionRecord,
} from "./session-index.js";

function record(id: string, vector: number[], doc: string): SessionRecord {
  return {
    sessionId: id,
    harness: "claude",
    projectPath: `/p/${id}`,
    projectName: id,
    transcriptPath: `/t/${id}.jsonl`,
    configDir: "/home/.claude",
    mtimeMs: 1000,
    docHash: `h-${id}`,
    vector: Float32Array.from(vector),
    goal: `goal ${id}`,
    doc,
  };
}

describe("SessionIndex", () => {
  it("upserts into both the vector store and the BM25 store", () => {
    const index = new SessionIndex();
    index.upsert(record("a", [1, 0], "design system effects"));
    expect(index.size).toBe(1);
    expect(index.bm25.size).toBe(1);
    expect([...index.bm25.score("effects").keys()]).toEqual(["a"]);
  });

  it("removes from both stores", () => {
    const index = new SessionIndex();
    index.upsert(record("a", [1, 0], "design system effects"));
    expect(index.remove("a")).toBe(true);
    expect(index.size).toBe(0);
    expect(index.bm25.size).toBe(0);
    expect(index.remove("a")).toBe(false);
  });

  it("reports a session as current only when its mtime is unchanged", () => {
    const index = new SessionIndex();
    index.upsert(record("a", [1, 0], "x"));
    expect(index.isCurrent("a", 1000)).toBe(true);
    expect(index.isCurrent("a", 2000)).toBe(false);
    expect(index.isCurrent("missing", 1000)).toBe(false);
  });

  it("ranks dense hits by cosine similarity, honouring k and the floor", () => {
    const index = new SessionIndex();
    index.upsert(record("near", [1, 0], "x"));
    index.upsert(record("far", [0, 1], "y"));
    const hits = index.searchDense(Float32Array.from([1, 0]), 5, 0.05);
    expect(hits.map((h) => h.sessionId)).toEqual(["near"]);
    expect(hits[0]!.score).toBeCloseTo(1, 5);
  });

  it("round-trips through JSON, rebuilding the BM25 store from the documents", () => {
    const index = new SessionIndex();
    index.upsert(record("a", [1, 0], "design system effects"));
    const restored = SessionIndex.fromJSON(JSON.parse(JSON.stringify(index.toJSON())));
    expect(restored.size).toBe(1);
    expect(restored.get("a")!.vector).toEqual(Float32Array.from([1, 0]));
    expect([...restored.bm25.score("effects").keys()]).toEqual(["a"]);
  });

  it("returns an empty index for a foreign version or a malformed payload", () => {
    expect(SessionIndex.fromJSON({ version: SESSION_INDEX_VERSION + 1, records: [] }).size).toBe(0);
    expect(SessionIndex.fromJSON({ version: SESSION_INDEX_VERSION }).size).toBe(0);
    expect(SessionIndex.fromJSON(null).size).toBe(0);
  });
});

describe("indexedText", () => {
  const record = { doc: "routine maintenance chore", customName: "Hydra migration" };

  it("puts the user's own name first, ahead of the session's text", () => {
    expect(indexedText(record)).toBe("Hydra migration\nroutine maintenance chore");
  });

  it("is the session's text alone when there is no name", () => {
    expect(indexedText({ doc: "routine maintenance chore" })).toBe("routine maintenance chore");
  });

  it("ignores a name that is only whitespace", () => {
    expect(indexedText({ doc: "chore", customName: "   " })).toBe("chore");
  });

  it("scores a session by its name once upserted", () => {
    const index = new SessionIndex();
    index.upsert({
      sessionId: "a",
      harness: "claude",
      projectPath: "/p",
      projectName: "p",
      transcriptPath: "/t/a.jsonl",
      configDir: "/c",
      mtimeMs: 1,
      docHash: "h",
      vector: Float32Array.from([1, 0]),
      goal: "g",
      doc: "routine maintenance chore",
      customName: "Hydra migration",
    });
    expect([...index.bm25.score("hydra").keys()]).toEqual(["a"]);
  });
});
