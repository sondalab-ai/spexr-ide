import { describe, expect, it } from "vitest";
import { relativeTime, stateLabel, groupByProject } from "./darkfactory-format.js";
import type { AgentSession } from "../../common/darkfactory-protocol.js";

describe("darkfactory-format", () => {
  it("relativeTime renders coarse buckets", () => {
    const now = 1_000_000_000_000;
    expect(relativeTime(now - 30_000, now)).toBe("just now");
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  it("stateLabel maps enum to copy", () => {
    expect(stateLabel("live")).toBe("Live");
    expect(stateLabel("idle")).toBe("Idle");
  });

  it("groupByProject clusters by projectPath, preserving order", () => {
    const mk = (id: string, path: string): AgentSession => ({
      sessionId: id,
      transcriptPath: `/t/${id}.jsonl`,
      projectPath: path,
      projectName: path.split("/").pop()!,
      state: "idle",
      lastActivityMs: 0,
      turnCount: 0,
      lastPrompt: "",
    });
    const groups = groupByProject([mk("a", "/x/p1"), mk("b", "/x/p2"), mk("c", "/x/p1")]);
    expect(groups.map((g) => g.projectPath)).toEqual(["/x/p1", "/x/p2"]);
    expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(["a", "c"]);
  });
});
