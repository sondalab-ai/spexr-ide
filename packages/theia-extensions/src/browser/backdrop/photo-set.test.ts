import { describe, expect, it } from "vitest";
import { CURATED } from "./photo-set.js";

describe("CURATED", () => {
  it("ships the eighteen credited NASA photos", () => {
    expect(CURATED).toHaveLength(18);
    expect(new Set(CURATED.map((p) => p.url)).size).toBe(18);
    for (const p of CURATED) {
      expect(p.credit?.via).toBe("NASA");
      expect(p.credit?.pageUrl).toMatch(/^https:\/\/images\.nasa\.gov\/details\//);
    }
  });
});
