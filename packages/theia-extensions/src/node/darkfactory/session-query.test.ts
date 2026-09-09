import { describe, expect, it } from "vitest";
import { SessionIndex, type SessionRecord } from "./session-index.js";
import { rankSessions } from "./session-query.js";

function record(id: string, vector: number[], doc: string): SessionRecord {
  return {
    sessionId: id,
    harness: "claude",
    projectPath: `/p/${id}`,
    projectName: id,
    transcriptPath: "",
    configDir: "",
    mtimeMs: 1,
    docHash: id,
    vector: Float32Array.from(vector),
    goal: doc,
    doc,
  };
}

describe("rankSessions", () => {
  it("ranks a session strong on both halves above one strong on neither", () => {
    const index = new SessionIndex();
    index.upsert(record("effects", [1, 0], "adding new effects to the spexr design system"));
    index.upsert(record("git", [0, 1], "hardening the git panel"));
    const ranked = rankSessions(index, Float32Array.from([1, 0]), "effects design system");
    expect(ranked[0]!.sessionId).toBe("effects");
    expect(ranked[0]!.score).toBeGreaterThan(0.18);
  });

  it("surfaces a lexical-only match the dense pass misses", () => {
    const index = new SessionIndex();
    index.upsert(record("effects", [0, 1], "introducing nuovi effetti nel design system"));
    index.upsert(record("git", [0, 1], "hardening the git panel"));
    const ranked = rankSessions(index, Float32Array.from([1, 0]), "effetti");
    expect(ranked.map((r) => r.sessionId)).toContain("effects");
  });

  it("drops everything below the minimum score", () => {
    const index = new SessionIndex();
    index.upsert(record("unrelated", [0, 1], "unrelated words entirely"));
    expect(rankSessions(index, Float32Array.from([1, 0]), "design system")).toEqual([]);
  });

  it("splits the score into the two halves it was blended from", () => {
    const index = new SessionIndex();
    index.upsert(record("effects", [1, 0], "adding new effects to the spexr design system"));
    const [hit] = rankSessions(index, Float32Array.from([1, 0]), "effects design system");
    expect(hit!.dense + hit!.lexical).toBeCloseTo(hit!.score, 10);
    expect(hit!.dense).toBeGreaterThan(0);
    expect(hit!.lexical).toBeGreaterThan(0);
  });

  it("carries no lexical half for a hit the dense pass alone found", () => {
    const index = new SessionIndex();
    index.upsert(record("effects", [1, 0], "adding new effects to the spexr design system"));
    index.upsert(record("git", [1, 0], "hardening the git panel"));
    const hit = rankSessions(index, Float32Array.from([1, 0]), "effects").find(
      (r) => r.sessionId === "git",
    );
    expect(hit!.lexical).toBe(0);
    expect(hit!.terms).toEqual([]);
  });

  it("reports the query terms that put a session in the results", () => {
    const index = new SessionIndex();
    index.upsert(record("effects", [1, 0], "adding new effects to the spexr design system"));
    const [hit] = rankSessions(index, Float32Array.from([1, 0]), "effects design nowhere");
    expect(hit!.terms).toContain("effects");
    expect(hit!.terms).not.toContain("nowhere");
  });

  it("returns at most 24 hits, best first", () => {
    const index = new SessionIndex();
    for (let i = 0; i < 40; i++) index.upsert(record(`s${i}`, [1, 0], "design system effects"));
    index.upsert(record("unrelated", [0, 1], "hardening the git panel"));
    const ranked = rankSessions(index, Float32Array.from([1, 0]), "design system effects");
    expect(ranked).toHaveLength(24);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[23]!.score);
  });
});
