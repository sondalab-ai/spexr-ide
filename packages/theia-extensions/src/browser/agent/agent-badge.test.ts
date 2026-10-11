import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLAUDE_TERMINAL_ID } from "./claude-terminal-id.js";
import { agentBadge } from "./agent-badge.js";
import { runningAgents } from "../titlebar/titlebar-model.js";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("the Agent tile's badge (S6d, A3)", () => {
  it("counts the running agents on the agent terminal's tile", () => {
    expect(agentBadge(CLAUDE_TERMINAL_ID, 2)).toEqual([{ badge: 2, tooltip: "2 agents running" }]);
    expect(agentBadge(CLAUDE_TERMINAL_ID, 14)).toEqual([{ badge: 14, tooltip: "14 agents running" }]);
  });

  it("is nothing at 0, and nothing on any other tile", () => {
    expect(agentBadge(CLAUDE_TERMINAL_ID, 0)).toEqual([]);
    expect(agentBadge("explorer-view-container", 2)).toEqual([]);
  });

  it("is the title bar's number: the working sessions", () => {
    const tiles = [{ state: "working" }, { state: "idle" }, { state: "working" }];
    expect(agentBadge(CLAUDE_TERMINAL_ID, runningAgents(tiles))).toEqual([{ badge: 2, tooltip: "2 agents running" }]);
  });

  it("is the title bar's count, from one shared service, and bound as a tab bar decorator", () => {
    const decorator = read("./agent-badge-decorator.ts");
    expect(decorator).toContain("@inject(SpexrAgentsCountService)");
    expect(decorator).not.toContain("new AgentsCount()");
    expect(read("../titlebar/spexr-titlebar-widget.tsx")).toContain("@inject(SpexrAgentsCountService)");
    expect(read("../titlebar/spexr-titlebar-widget.tsx")).not.toContain("new AgentsCount()");
    expect(read("../titlebar/agents-count-service.ts")).toContain('window.removeEventListener("focus", this.onFocus)');
    expect(decorator).toContain("agentBadge(title.owner.id, this.count.count)");
    expect(read("../spexr-frontend-module.ts")).toContain("bind(TabBarDecorator).toService(SpexrAgentBadgeDecorator)");
  });
});

describe("the badge in words (S6d review)", () => {
  it("carries the count as a tooltip Theia appends to the tab's own, and never touches the caption", () => {
    expect(agentBadge(CLAUDE_TERMINAL_ID, 1)).toEqual([{ badge: 1, tooltip: "1 agent running" }]);
    expect(read("./agent-badge-decorator.ts")).not.toContain("title.caption");
    expect(read("../../../../../node_modules/@theia/core/src/browser/shell/tab-bars.ts")).toContain("ArrayUtils.coalesce([title.caption, ...this.getDecorationData(title, 'tooltip')])");
  });

  it("covers a widget created after the count is above 0: the decoration is computed per title, from the live count", () => {
    expect(read("./agent-badge-decorator.ts")).toContain("agentBadge(title.owner.id, this.count.count)");
  });

  it("is r6 in every area, not only the side bars: the badge also renders on a main-area tab when the agent terminal is moved there", () => {
    const css = read("../style/spexr.css");
    const start = css.indexOf(".theia-badge-decorator-sidebar,\n.lm-TabBar .theia-badge-decorator-horizontal {");
    expect(start).toBeGreaterThan(0);
    expect(css.slice(start, css.indexOf("}", start))).toMatch(/border-radius:\s*6px/);
    const sides = css.indexOf(".lm-TabBar.theia-app-sides .theia-badge-decorator-sidebar {");
    expect(css.slice(sides, css.indexOf("}", sides))).toMatch(/border-radius:\s*6px/);
  });
});
