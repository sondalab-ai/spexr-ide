import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLAUDE_TERMINAL_ID } from "./claude-terminal-id.js";
import { agentBadge } from "./agent-badge.js";
import { runningAgents } from "../titlebar/titlebar-model.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("the Agent tile's badge (S6d, A3)", () => {
  it("counts the running agents on the agent terminal's tile", () => {
    expect(agentBadge(CLAUDE_TERMINAL_ID, 2)).toEqual([{ badge: 2 }]);
    expect(agentBadge(CLAUDE_TERMINAL_ID, 14)).toEqual([{ badge: 14 }]);
  });

  it("is nothing at 0, and nothing on any other tile", () => {
    expect(agentBadge(CLAUDE_TERMINAL_ID, 0)).toEqual([]);
    expect(agentBadge("explorer-view-container", 2)).toEqual([]);
  });

  it("is the title bar's number: the working sessions", () => {
    const tiles = [{ state: "working" }, { state: "idle" }, { state: "working" }];
    expect(agentBadge(CLAUDE_TERMINAL_ID, runningAgents(tiles))).toEqual([{ badge: 2 }]);
  });

  it("is fed through the same hold as the pill, and bound as a tab bar decorator", () => {
    const decorator = read("./agent-badge-decorator.ts");
    expect(decorator).toContain("new AgentsCount()");
    expect(decorator).toContain("agentBadge(title.owner.id, this.running)");
    expect(read("../spexr-frontend-module.ts")).toContain("bind(TabBarDecorator).toService(SpexrAgentBadgeDecorator)");
  });
});
