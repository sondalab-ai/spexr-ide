import { describe, expect, it } from "vitest";
import { AGENT_TAB_NAME_MAX, AGENTS_TAB_ICON, agentsTabLabel, clipTabName } from "./agents-tab-title.js";

describe("the Darkfactory tab's title", () => {
  it("is Agents for the wall", () => {
    expect(agentsTabLabel()).toBe("Agents");
    expect(agentsTabLabel("")).toBe("Agents");
    expect(agentsTabLabel("   ")).toBe("Agents");
  });

  it("is Agent · <name> with a session open", () => {
    expect(agentsTabLabel("audit")).toBe("Agent · audit");
    expect(agentsTabLabel("  Refactor the audit ")).toBe("Agent · Refactor the audit");
  });

  it("wears the sparkle", () => {
    expect(AGENTS_TAB_ICON).toBe("codicon codicon-sparkle");
  });
});

describe("a long name (S6c review)", () => {
  it("is cut to a tab's width with an ellipsis, on a word boundary where there is one", () => {
    const long = "Refactor the audit so that every colour literal outside the token file is reported with its line";
    const label = agentsTabLabel(long);
    expect(label.startsWith("Agent · Refactor the audit")).toBe(true);
    expect(label.endsWith("…")).toBe(true);
    expect(label.length).toBeLessThanOrEqual("Agent · ".length + AGENT_TAB_NAME_MAX);
  });

  it("leaves a name that fits, and cuts an unbroken one at the limit", () => {
    expect(clipTabName("audit")).toBe("audit");
    expect(clipTabName("x".repeat(60))).toBe(`${"x".repeat(AGENT_TAB_NAME_MAX - 1)}…`);
  });
});
