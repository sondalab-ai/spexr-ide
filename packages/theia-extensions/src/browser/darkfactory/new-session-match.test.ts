import { describe, expect, it } from "vitest";
import { matchLaunchedSession, type MatchableTile } from "./new-session-match.js";

const PROJ = "/Users/x/proj";
const OTHER = "/Users/x/other";

function tile(sessionId: string, projectPath: string, lastActivityMs: number): MatchableTile {
  return { sessionId, projectPath, lastActivityMs };
}

describe("matchLaunchedSession", () => {
  it("finds nothing while the harness has not written a transcript yet", () => {
    const known = new Set(["old"]);
    expect(matchLaunchedSession(PROJ, known, [tile("old", PROJ, 1)])).toBeUndefined();
  });

  it("recognises the one session that appeared in the project", () => {
    const known = new Set(["old"]);
    const tiles = [tile("old", PROJ, 1), tile("fresh", PROJ, 2)];
    expect(matchLaunchedSession(PROJ, known, tiles)).toBe("fresh");
  });

  it("takes the most recently active when two appeared at once", () => {
    const tiles = [tile("a", PROJ, 5), tile("b", PROJ, 9)];
    expect(matchLaunchedSession(PROJ, new Set(), tiles)).toBe("b");
  });

  it("ignores a new session in another project", () => {
    expect(matchLaunchedSession(PROJ, new Set(), [tile("elsewhere", OTHER, 9)])).toBeUndefined();
  });

  it("finds nothing in an empty wall", () => {
    expect(matchLaunchedSession(PROJ, new Set(), [])).toBeUndefined();
  });
});
