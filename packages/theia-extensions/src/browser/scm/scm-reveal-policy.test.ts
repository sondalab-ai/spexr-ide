import { describe, expect, it } from "vitest";
import { REVEAL_THRESHOLD, shouldReveal } from "./scm-reveal-policy.js";

describe("shouldReveal", () => {
  it("shows the section once the workspace holds a second repository", () => {
    expect(shouldReveal(REVEAL_THRESHOLD)).toBe(true);
    expect(shouldReveal(5)).toBe(true);
  });

  it("stays hidden below the threshold, matching Theia's own default", () => {
    expect(shouldReveal(0)).toBe(false);
    expect(shouldReveal(1)).toBe(false);
  });
});
