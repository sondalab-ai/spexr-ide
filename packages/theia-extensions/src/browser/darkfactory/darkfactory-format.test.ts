import { describe, expect, test } from "vitest";
import { relativeTime, stateLabel, sortTiles, permissionLabel, modeLabel } from "./darkfactory-format.js";
import type { AgentTile } from "../../common/darkfactory-protocol.js";

const tile = (id: string, state: AgentTile["state"], needsYou = false, lastActivityMs = 0): AgentTile => ({
  sessionId: id,
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
});
