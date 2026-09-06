import { describe, expect, it } from "vitest";
import type { AgentState, AgentTile } from "../../common/darkfactory-protocol.js";
import { MIN_REFRESH_GAP_MS, shouldRefresh, type SummaryState } from "./summary-refresh.js";

const NOW = 1_800_000_000_000;

function tile(over: Partial<AgentTile> = {}): AgentTile {
  return {
    sessionId: "s1",
    harness: "claude",
    transcriptPath: "/p/s1.jsonl",
    projectPath: "/p",
    projectName: "p",
    state: "working" as AgentState,
    needsYou: false,
    needsYouCertain: false,
    lastFailed: false,
    goal: "ship it",
    actionLine: "editing src/a.ts",
    recentActions: [],
    lastActivityMs: NOW,
    turnCount: 3,
    accentId: 0,
    ...over,
  };
}

/** A summary taken one turn and one action ago, old enough to be past the floor. */
function summarized(over: Partial<SummaryState> = {}): SummaryState {
  return {
    summary: { now: "", overview: "" },
    loading: false,
    mtime: NOW - 60_000,
    turnCount: 2,
    action: "reading src/b.ts",
    at: NOW - MIN_REFRESH_GAP_MS,
    ...over,
  };
}

describe("shouldRefresh", () => {
  it("refreshes a session that grew and took a new turn", () => {
    expect(shouldRefresh(tile(), summarized(), NOW)).toBe(true);
  });

  it("refreshes a session that grew and changed action without a new turn", () => {
    expect(shouldRefresh(tile({ turnCount: 2 }), summarized(), NOW)).toBe(true);
  });

  it("holds off until the floor between two refreshes has passed", () => {
    expect(shouldRefresh(tile(), summarized({ at: NOW - MIN_REFRESH_GAP_MS + 1 }), NOW)).toBe(false);
  });

  it("leaves a session alone when the transcript has not grown", () => {
    expect(shouldRefresh(tile({ lastActivityMs: NOW - 60_000 }), summarized(), NOW)).toBe(false);
  });

  it("leaves a session alone when it grew but neither turn nor action moved", () => {
    // Streamed text and repeated same-tool calls grow the file without the agent
    // moving on; re-inferring on those would monopolize the single model.
    const cur = summarized({ turnCount: 3, action: "editing src/a.ts" });
    expect(shouldRefresh(tile(), cur, NOW)).toBe(false);
  });

  it.each<AgentState>(["idle", "done"])("refreshes a session reported as %s", (state) => {
    // The regression: gating on state === "working" starved exactly the cards the
    // user watches. `classifySession` only calls a session working while it is
    // live, fresh AND the newest transcript in its project — so one that has just
    // ended its turn, or that shares a project with a newer session, was frozen
    // at its first summary however much it moved.
    expect(shouldRefresh(tile({ state }), summarized(), NOW)).toBe(true);
  });

  it("keeps refreshing a session that grew again while its summary was being inferred", () => {
    // The recorded mtime is the one seen when the refresh was queued, so growth
    // during the inference must still count as new on the next scan.
    const queuedAt = NOW - 60_000;
    const cur = summarized({ mtime: queuedAt, turnCount: 3, action: "editing src/a.ts", at: NOW - MIN_REFRESH_GAP_MS });
    expect(shouldRefresh(tile({ lastActivityMs: queuedAt + 1, turnCount: 4 }), cur, NOW)).toBe(true);
  });
});
