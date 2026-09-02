import { describe, expect, test } from "vitest";
import {
  relativeTime,
  stateLabel,
  sortTiles,
  permissionLabel,
  modeLabel,
  groupTiles,
  summaryTargets,
  launchTargets,
} from "./darkfactory-format.js";
import type { AgentTile } from "../../common/darkfactory-protocol.js";

const tile = (
  id: string,
  state: AgentTile["state"],
  needsYou = false,
  lastActivityMs = 0,
  over: Partial<AgentTile> = {},
): AgentTile => ({
  sessionId: id,
  harness: "claude",
  transcriptPath: `/p/${id}.jsonl`,
  projectPath: "/p",
  projectName: "p",
  state,
  needsYou,
  needsYouCertain: false,
  lastFailed: false,
  goal: "",
  actionLine: "",
  recentActions: [],
  lastActivityMs,
  turnCount: 0,
  accentId: 0,
  ...over,
});

describe("darkfactory-format", () => {
  test("relativeTime renders coarse buckets", () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  test("stateLabel maps v2 states to copy", () => {
    expect(stateLabel("working")).toBe("Working");
    expect(stateLabel("idle")).toBe("Idle");
    expect(stateLabel("done")).toBe("Done");
  });

  test("sortTiles: needs-you first (by state), then working, idle, done", () => {
    const out = sortTiles([
      tile("a", "done"),
      tile("b", "working"),
      tile("c", "idle", true),
      tile("d", "working", true),
    ]);
    expect(out.map((x) => x.sessionId)).toEqual(["d", "c", "b", "a"]);
  });

  test("permissionLabel maps modes to human copy", () => {
    expect(permissionLabel("auto")).toBe("Auto-approve tools");
    expect(permissionLabel("default")).toBe("Ask each time");
    expect(permissionLabel("plan")).toBe("Plan mode");
  });

  test("modeLabel hides the default mode", () => {
    expect(modeLabel("normal")).toBeUndefined();
    expect(modeLabel("accept-edits")).toBe("Accept edits");
  });

  test("groupTiles buckets sessions by projectPath, ordering members by attention", () => {
    const out = groupTiles([
      tile("a", "idle", false, 10, { projectPath: "/x", projectName: "x" }),
      tile("b", "working", false, 20, { projectPath: "/y", projectName: "y" }),
      tile("c", "working", true, 5, { projectPath: "/x", projectName: "x" }),
    ]);
    expect(out.map((g) => g.projectPath)).toEqual(["/x", "/y"]);
    expect(out[0]!.tiles.map((t) => t.sessionId)).toEqual(["c", "a"]);
    expect(out[1]!.tiles.map((t) => t.sessionId)).toEqual(["b"]);
  });

  test("groupTiles orders groups by their best attention rank", () => {
    const out = groupTiles([
      tile("a", "done", false, 100, { projectPath: "/x", projectName: "x" }),
      tile("b", "idle", false, 50, { projectPath: "/y", projectName: "y" }),
      tile("c", "working", false, 10, { projectPath: "/z", projectName: "z" }),
    ]);
    expect(out.map((g) => g.projectPath)).toEqual(["/z", "/y", "/x"]);
  });

  test("groupTiles breaks an attention tie with the most recent activity", () => {
    const out = groupTiles([
      tile("a", "idle", false, 10, { projectPath: "/x", projectName: "x" }),
      tile("b", "idle", false, 99, { projectPath: "/y", projectName: "y" }),
    ]);
    expect(out.map((g) => g.projectPath)).toEqual(["/y", "/x"]);
  });

  test("groupTiles lifts the current project above everything else", () => {
    const out = groupTiles(
      [
        tile("a", "working", true, 100, { projectPath: "/x", projectName: "x" }),
        tile("b", "done", false, 1, { projectPath: "/y", projectName: "y" }),
      ],
      "/y",
    );
    expect(out.map((g) => g.projectPath)).toEqual(["/y", "/x"]);
    expect(out[0]!.isCurrent).toBe(true);
    expect(out[1]!.isCurrent).toBe(false);
  });

  test("groupTiles matches the current project despite a trailing slash", () => {
    const out = groupTiles([tile("a", "idle", false, 0, { projectPath: "/x", projectName: "x" })], "/x/");
    expect(out[0]!.isCurrent).toBe(true);
  });

  test("groupTiles disambiguates same-named projects with their parent folder", () => {
    const out = groupTiles([
      tile("a", "working", false, 20, { projectPath: "/home/me/work/spexr", projectName: "spexr" }),
      tile("b", "working", false, 10, { projectPath: "/home/me/mine/spexr", projectName: "spexr" }),
      tile("c", "working", false, 5, { projectPath: "/home/me/other", projectName: "other" }),
    ]);
    expect(out.map((g) => g.label)).toEqual(["spexr — work", "spexr — mine", "other"]);
  });

  test("groupTiles carries the shared accent of its members", () => {
    const out = groupTiles([tile("a", "idle", false, 0, { projectPath: "/x", projectName: "x", accentId: 3 })]);
    expect(out[0]!.accentId).toBe(3);
  });

  test("groupTiles returns nothing for no sessions", () => {
    expect(groupTiles([])).toEqual([]);
  });

  test("summaryTargets takes the most urgent sessions, flat", () => {
    const out = summaryTargets(
      [
        tile("a", "done", false, 30, { projectPath: "/x", projectName: "x" }),
        tile("b", "working", false, 20, { projectPath: "/x", projectName: "x" }),
        tile("c", "idle", false, 10, { projectPath: "/x", projectName: "x" }),
      ],
      undefined,
      2,
      0,
    );
    expect(out).toEqual(["b", "c"]);
  });

  test("summaryTargets also covers the lead session of every visible group", () => {
    const out = summaryTargets(
      [
        tile("a", "working", true, 90, { projectPath: "/x", projectName: "x" }),
        tile("b", "working", false, 80, { projectPath: "/x", projectName: "x" }),
        tile("c", "idle", false, 70, { projectPath: "/y", projectName: "y" }),
        tile("d", "done", false, 60, { projectPath: "/z", projectName: "z" }),
      ],
      undefined,
      2,
      3,
    );
    expect(out).toEqual(["a", "b", "c", "d"]);
  });

  test("summaryTargets ignores groups past the visible limit", () => {
    const out = summaryTargets(
      [
        tile("a", "working", false, 90, { projectPath: "/x", projectName: "x" }),
        tile("b", "idle", false, 80, { projectPath: "/y", projectName: "y" }),
        tile("c", "done", false, 70, { projectPath: "/z", projectName: "z" }),
      ],
      undefined,
      1,
      2,
    );
    expect(out).toEqual(["a", "b"]);
  });
});

describe("launchTargets", () => {
  test("offers every project on the wall, alphabetically", () => {
    const targets = launchTargets([
      tile("a", "idle", false, 0, { projectPath: "/w/beta", projectName: "beta" }),
      tile("b", "idle", false, 0, { projectPath: "/w/alpha", projectName: "alpha" }),
    ]);
    expect(targets.map((t) => t.name)).toEqual(["alpha", "beta"]);
  });

  test("puts the window's own project first", () => {
    const targets = launchTargets(
      [
        tile("a", "idle", false, 0, { projectPath: "/w/alpha", projectName: "alpha" }),
        tile("b", "idle", false, 0, { projectPath: "/w/beta", projectName: "beta" }),
      ],
      "/w/beta",
    );
    expect(targets.map((t) => t.name)).toEqual(["beta", "alpha"]);
  });

  test("includes the current project even with no session on the wall", () => {
    expect(launchTargets([], "/w/fresh/proj")).toEqual([{ path: "/w/fresh/proj", name: "proj" }]);
  });

  test("lists a project once however many sessions it has", () => {
    const targets = launchTargets([
      tile("a", "idle", false, 0, { projectPath: "/w/one", projectName: "one" }),
      tile("b", "idle", false, 0, { projectPath: "/w/one", projectName: "one" }),
    ]);
    expect(targets).toHaveLength(1);
  });

  test("is empty when there is nothing to start in", () => {
    expect(launchTargets([])).toEqual([]);
  });
});
