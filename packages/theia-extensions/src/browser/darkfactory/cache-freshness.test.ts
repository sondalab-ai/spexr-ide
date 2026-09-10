import { describe, expect, it } from "vitest";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { CACHE_TTL_MS } from "../../common/darkfactory-protocol.js";
import {
  EXPIRING_WINDOW_MS,
  cacheFreshness,
  expiringTiles,
  expiryLabel,
  formatTokens,
} from "./cache-freshness.js";

const NOW = 1_000_000_000_000;

const tile = (id: string, over: Partial<AgentTile> = {}): AgentTile => ({
  sessionId: id,
  harness: "claude",
  transcriptPath: `/p/${id}.jsonl`,
  projectPath: "/p",
  projectName: "p",
  state: "idle",
  needsYou: false,
  needsYouCertain: false,
  lastFailed: false,
  goal: "",
  actionLine: "",
  recentActions: [],
  lastActivityMs: NOW,
  turnCount: 0,
  accentId: 0,
  ...over,
});

describe("cacheFreshness", () => {
  it("leaves room for a warm state between the window and the TTL", () => {
    // The three states only exist while the alert is narrower than the lifetime
    // it warns about; tuning either constant past the other erases "warm".
    expect(EXPIRING_WINDOW_MS).toBeLessThan(CACHE_TTL_MS);
  });

  it("says nothing about a session that never reported usage", () => {
    expect(cacheFreshness(tile("a"), NOW)).toBeUndefined();
  });

  it("is warm while more than the window remains", () => {
    const t = tile("a", { cacheDeadlineMs: NOW + EXPIRING_WINDOW_MS + 1 });
    expect(cacheFreshness(t, NOW)).toEqual({
      kind: "warm",
      remainingMs: EXPIRING_WINDOW_MS + 1,
    });
  });

  it("is expiring from the moment the window opens", () => {
    const t = tile("a", { cacheDeadlineMs: NOW + EXPIRING_WINDOW_MS });
    expect(cacheFreshness(t, NOW)?.kind).toBe("expiring");
  });

  it("is cold at the deadline, and reports no time left", () => {
    const t = tile("a", { cacheDeadlineMs: NOW });
    expect(cacheFreshness(t, NOW)).toEqual({ kind: "cold", remainingMs: 0 });
    expect(cacheFreshness(t, NOW + 5 * 60_000)).toEqual({ kind: "cold", remainingMs: 0 });
  });
});

describe("expiringTiles", () => {
  it("keeps only the sessions inside the window, in the order given", () => {
    const warm = tile("warm", { cacheDeadlineMs: NOW + CACHE_TTL_MS });
    const soon = tile("soon", { cacheDeadlineMs: NOW + 2 * 60_000 });
    const cold = tile("cold", { cacheDeadlineMs: NOW - 60_000 });
    const unknown = tile("unknown");
    expect(expiringTiles([warm, soon, cold, unknown], NOW).map((t) => t.sessionId)).toEqual(["soon"]);
  });
});

describe("expiryLabel", () => {
  it("rounds up, and never says zero while the cache is alive", () => {
    expect(expiryLabel(9 * 60_000)).toBe("9m");
    expect(expiryLabel(8 * 60_000 + 1)).toBe("9m");
    expect(expiryLabel(1_000)).toBe("1m");
  });
});

describe("formatTokens", () => {
  it("reads at a glance across three orders of magnitude", () => {
    expect(formatTokens(512)).toBe("512");
    expect(formatTokens(20_502)).toBe("21K");
    expect(formatTokens(911_847)).toBe("912K");
    expect(formatTokens(1_240_000)).toBe("1.2M");
  });
});
