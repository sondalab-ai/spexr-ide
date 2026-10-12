import { describe, expect, it } from "vitest";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { STALE_MS } from "../../common/session-timing.js";
import { SESSION_ROWS_MAX, agentsPill, formatAge, formatTokPerSec, modelItem, rowMeta, sessionRows, focusTarget, inWorkspace, shouldAddSessionsPart, toolsLabel, viewTarget } from "./sessions-model.js";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const tile = (sessionId: string, over: Partial<AgentTile> = {}): AgentTile =>
  ({ sessionId, harness: "claude", transcriptPath: "", projectPath: "/w/probe-engine", projectName: "probe-engine", state: "done", needsYou: false, needsYouCertain: true, lastFailed: false, goal: "", actionLine: "", recentActions: [], lastActivityMs: NOW, turnCount: 1, accentId: 0, ...over }) as AgentTile;

// The demo's three rows (showcase/screens.js), as the fixture's sessions produce them.
const refactor = tile("a", { customName: "Refactor the audit", state: "working", toolCount: 14, lastActivityMs: NOW });
const prism = tile("b", { customName: "Prism light theme", toolCount: 212, lastActivityMs: NOW - 60 * MIN });
const edge = tile("c", { customName: "Edge in shade", toolCount: 58, lastActivityMs: NOW - 180 * MIN });
const site = tile("d", { customName: "Marketing site rebuild", state: "working", toolCount: 198, projectPath: "/w/prism-site" });

describe("formatAge", () => {
  it("writes now, minutes, hours and days, dropping the remainder", () => {
    expect(formatAge(0)).toBe("now");
    expect(formatAge(59_999)).toBe("now");
    expect(formatAge(5 * MIN)).toBe("5m");
    expect(formatAge(60 * MIN)).toBe("1h");
    expect(formatAge(179 * MIN)).toBe("2h");
    expect(formatAge(180 * MIN)).toBe("3h");
    expect(formatAge(26 * 60 * MIN)).toBe("1d");
    expect(formatAge(-5)).toBe("now");
  });
});

describe("rowMeta", () => {
  it("is the demo's three lines: running has no age, the others say how long ago", () => {
    expect(rowMeta(refactor, NOW)).toBe("running · 14 tools");
    expect(rowMeta(prism, NOW)).toBe("done · 1h · 212 tools");
    expect(rowMeta(edge, NOW)).toBe("done · 3h · 58 tools");
  });

  it("says 1 tool, and leaves the count out until the transcript has been counted", () => {
    expect(toolsLabel(1)).toBe("1 tool");
    expect(toolsLabel(0)).toBe("0 tools");
    expect(rowMeta(tile("x", { toolCount: 1 }), NOW)).toBe("done · now · 1 tool");
    expect(rowMeta(tile("x"), NOW)).toBe("done · now");
  });

  it("says waiting for a session that needs the user, and done for one with no process, as the demo does", () => {
    expect(rowMeta(tile("x", { state: "working", needsYou: true, toolCount: 3 }), NOW)).toBe("waiting · now · 3 tools");
    expect(rowMeta(tile("x", { state: "idle", lastActivityMs: NOW - 5 * MIN }), NOW)).toBe("done · 5m");
  });
});

describe("inWorkspace", () => {
  it("holds a root, its subfolders and any spelling of the root's path, but not a sibling with the same prefix", () => {
    expect(inWorkspace("/w/probe-engine", ["/w/probe-engine"])).toBe(true);
    expect(inWorkspace("/w/probe-engine/", ["/w/probe-engine"])).toBe(true);
    expect(inWorkspace("/w/probe-engine/packages/app", ["/w/probe-engine"])).toBe(true);
    expect(inWorkspace("/w/probe-engine2", ["/w/probe-engine"])).toBe(false);
    expect(inWorkspace("/w/other", ["/w/probe-engine", "/w/other"])).toBe(true);
    expect(inWorkspace("/w/other", [])).toBe(false);
  });
});

describe("sessionRows", () => {
  const ROOTS = ["/w/probe-engine"];

  it("lists this workspace's sessions only, the running one first and then the newest, named as the wall names them", () => {
    const { rows, more } = sessionRows([edge, site, prism, refactor], ROOTS, NOW);
    expect(rows.map((r) => [r.name, r.meta])).toEqual([
      ["Refactor the audit", "running · 14 tools"],
      ["Prism light theme", "done · 1h · 212 tools"],
      ["Edge in shade", "done · 3h · 58 tools"],
    ]);
    expect(more).toBe(0);
  });

  it("takes the sessions of every root and of subfolders, however the root's path is spelled, and has none without a root", () => {
    const sub = tile("sub", { projectPath: "/w/probe-engine/packages/app", customName: "In a subfolder" });
    const other = tile("other", { projectPath: "/w/second-root", customName: "Second root" });
    expect(sessionRows([refactor, sub], ["/w/probe-engine/"], NOW).rows.map((r) => r.name)).toEqual(["Refactor the audit", "In a subfolder"]);
    expect(sessionRows([refactor, other, site], ["/w/probe-engine", "/w/second-root"], NOW).rows.map((r) => r.name).sort()).toEqual(["Refactor the audit", "Second root"]);
    expect(sessionRows([refactor], [], NOW)).toEqual({ rows: [], more: 0 });
  });

  it("carries each row's harness, so a row from another CLI can be sent to the wall instead of the pane", () => {
    const oc = tile("oc", { harness: "opencode", customName: "An opencode session" });
    expect(sessionRows([refactor, oc], ROOTS, NOW).rows.map((r) => r.harness)).toEqual(["claude", "opencode"]);
  });

  it("caps the list and says how many more there are", () => {
    const many = Array.from({ length: SESSION_ROWS_MAX + 5 }, (_, i) => tile(`s${i}`, { customName: `n${i}`, lastActivityMs: NOW - i * MIN }));
    const { rows, more } = sessionRows(many, ROOTS, NOW);
    expect(rows).toHaveLength(SESSION_ROWS_MAX);
    expect(more).toBe(5);
  });

  it("shows the followed session even past the cap, pinned at the end, and counts the rest without it", () => {
    const many = Array.from({ length: SESSION_ROWS_MAX + 5 }, (_, i) => tile(`s${i}`, { customName: `n${i}`, lastActivityMs: NOW - i * MIN }));
    const last = `s${SESSION_ROWS_MAX + 4}`;
    const { rows, more } = sessionRows(many, ROOTS, NOW, last);
    expect(rows).toHaveLength(SESSION_ROWS_MAX + 1);
    expect(rows[rows.length - 1]!.sessionId).toBe(last);
    expect(more).toBe(4);
    // Inside the cap it is where it sorts, with nothing added.
    expect(sessionRows(many, ROOTS, NOW, "s2").rows).toHaveLength(SESSION_ROWS_MAX);
    // A followed session of another project is not this list's to show.
    expect(sessionRows(many, ROOTS, NOW, "nope").rows).toHaveLength(SESSION_ROWS_MAX);
  });

  it("takes the name the agent pane's head gives the followed session when the scan has none yet, and never over a name the user gave", () => {
    const unnamed = tile("a", { goal: "Make cache.write awaited and keep the p95 under 2 ms. Show me the evidence." });
    expect(sessionRows([unnamed], ROOTS, NOW, "a", { sessionId: "a", title: "Refactor the audit" }).rows[0]!.name).toBe("Refactor the audit");
    expect(sessionRows([unnamed], ROOTS, NOW, "a").rows[0]!.name).toBe("Make cache.write awaited and keep the p95 under 2 ms");
    expect(sessionRows([refactor], ROOTS, NOW, "a", { sessionId: "a", title: "Other" }).rows[0]!.name).toBe("Refactor the audit");
    expect(sessionRows([unnamed], ROOTS, NOW, "a", { sessionId: "z", title: "Other" }).rows[0]!.name).toBe("Make cache.write awaited and keep the p95 under 2 ms");
  });

  it("falls back to the session id's head for a session with nothing to call it", () => {
    expect(sessionRows([tile("8f2a4c1e-3b7d")], ROOTS, NOW).rows[0]!.name).toBe("8f2a4c1e");
  });
});

describe("follow switching", () => {
  const { rows } = sessionRows([refactor, prism, edge], ["/w/probe-engine"], NOW);

  it("points the pane at another session, and back at the agent's own with no override", () => {
    const row = (sessionId: string) => ({ sessionId, name: "", state: "done" as const, meta: "", harness: "claude" as const, projectPath: "/w/proj/sub" });
    expect(viewTarget(row("b"), "a")).toEqual({ sessionId: "b", projectPath: "/w/proj/sub" });
    expect(viewTarget(row("a"), "a")).toBeUndefined();
    expect(viewTarget(row("a"), undefined)).toEqual({ sessionId: "a", projectPath: "/w/proj/sub" });
  });

  it("moves focus by arrow key, Home and End, stopping at the ends, and starts from the nearest end with no current row", () => {
    expect(focusTarget(rows, "a", "ArrowDown")).toBe("b");
    expect(focusTarget(rows, "b", "ArrowUp")).toBe("a");
    expect(focusTarget(rows, "a", "ArrowUp")).toBe("a");
    expect(focusTarget(rows, "c", "ArrowDown")).toBe("c");
    expect(focusTarget(rows, undefined, "ArrowDown")).toBe("a");
    expect(focusTarget(rows, "zzz", "ArrowUp")).toBe("c");
    expect(focusTarget(rows, "b", "Home")).toBe("a");
    expect(focusTarget(rows, "b", "End")).toBe("c");
    expect(focusTarget([], "a", "End")).toBeUndefined();
  });
});

describe("agentsPill", () => {
  it("sums the tool calls of the live sessions only: 14 + 198 = 212", () => {
    const pill = agentsPill([refactor, site]);
    expect(pill).toEqual({ agents: 2, tools: 212, text: "2 agents · 212 tools" });
  });

  it("is hidden at 0", () => {
    expect(agentsPill([])).toBeUndefined();
  });

  it("says 1 agent, and leaves the calls out while none has been counted", () => {
    expect(agentsPill([tile("x", { state: "working", toolCount: 1 })])?.text).toBe("1 agent · 1 tool");
    expect(agentsPill([tile("x", { state: "working" })])?.text).toBe("1 agent");
  });
});

describe("formatTokPerSec", () => {
  it("writes whole numbers below 1000 and thousands with one decimal above", () => {
    expect(formatTokPerSec(86.4)).toBe("86");
    expect(formatTokPerSec(499.6)).toBe("500");
    expect(formatTokPerSec(999.4)).toBe("999");
    expect(formatTokPerSec(1000)).toBe("1k");
    expect(formatTokPerSec(1200)).toBe("1.2k");
    expect(formatTokPerSec(1249)).toBe("1.2k");
    expect(formatTokPerSec(1250)).toBe("1.3k");
    expect(formatTokPerSec(12_000)).toBe("12k");
  });
});

describe("modelItem", () => {
  const fresh = { model: "claude-opus-5-5", tokPerSec: 86, updatedAtMs: NOW - 5_000 };

  it("is the model's family and the rate of the latest reply", () => {
    expect(modelItem(fresh, NOW)).toEqual({ family: "Opus", text: "Opus · 86 tok/s" });
  });

  it("is hidden with no snapshot, no model, no rate, or a transcript silent for longer than a working session may be", () => {
    expect(modelItem(undefined, NOW)).toBeUndefined();
    expect(modelItem({ ...fresh, model: undefined }, NOW)).toBeUndefined();
    expect(modelItem({ ...fresh, tokPerSec: undefined }, NOW)).toBeUndefined();
    expect(modelItem({ ...fresh, tokPerSec: 0 }, NOW)).toBeUndefined();
    expect(modelItem({ ...fresh, updatedAtMs: undefined }, NOW)).toBeUndefined();
    expect(modelItem({ ...fresh, updatedAtMs: NOW - STALE_MS - 1 }, NOW)).toBeUndefined();
    expect(modelItem({ ...fresh, updatedAtMs: NOW - STALE_MS }, NOW)).toBeDefined();
  });

  it("keeps showing for a session the backend calls working, whatever the entries' stamps say", () => {
    expect(modelItem({ ...fresh, state: "working", updatedAtMs: NOW - 3 * 3_600_000 }, NOW)?.text).toBe("Opus · 86 tok/s");
    expect(modelItem({ ...fresh, state: "done", updatedAtMs: NOW - 3 * 3_600_000 }, NOW)).toBeUndefined();
    expect(modelItem({ ...fresh, state: "idle", updatedAtMs: NOW - 5_000 }, NOW)).toBeDefined();
  });
});

describe("shouldAddSessionsPart", () => {
  it("adds the part to a freshly created Explorer container, so Reset Layout does not lose it", () => {
    expect(shouldAddSessionsPart("explorer", "explorer", false)).toBe(true);
  });

  it("does not add it twice, nor to any other container", () => {
    expect(shouldAddSessionsPart("explorer", "explorer", true)).toBe(false);
    expect(shouldAddSessionsPart("scm-view-container", "explorer", false)).toBe(false);
  });
});
