import { describe, expect, it } from "vitest";
import { AGENTS_TAB_ICON, agentsTabLabel } from "./agents-tab-title.js";

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
