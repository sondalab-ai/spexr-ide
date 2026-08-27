import { describe, it, expect } from "vitest";
import { EXPERT_CATALOG } from "./catalog.js";

describe("EXPERT_CATALOG", () => {
  it("has unique ids", () => {
    const ids = EXPERT_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes the built-in presets", () => {
    expect(EXPERT_CATALOG.map((e) => e.id).sort()).toEqual([
      "brainstorming",
      "changelog-writer",
      "design",
      "dri",
      "marketing",
      "review",
      "software-engineering",
    ]);
  });

  it("has all required fields non-empty", () => {
    for (const e of EXPERT_CATALOG) {
      expect(e.name.length).toBeGreaterThan(0);
      expect(e.icon.length).toBeGreaterThan(0);
      expect(e.color.length).toBeGreaterThan(0);
      expect(e.description.length).toBeGreaterThan(0);
      expect(e.systemPrompt.length).toBeGreaterThan(0);
    }
  });
});
