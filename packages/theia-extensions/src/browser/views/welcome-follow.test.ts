import { describe, it, expect } from "vitest";
import { followStep } from "./welcome-follow.js";

describe("followStep", () => {
  it("eases part of the way toward the target", () => {
    const next = followStep({ x: 0, y: 0 }, { x: 1, y: -1 }, 0.1);
    expect(next.x).toBeCloseTo(0.1);
    expect(next.y).toBeCloseTo(-0.1);
    expect(next.settled).toBe(false);
  });

  it("settles on the target once the gap is below what the CSS can show", () => {
    const next = followStep({ x: 0.99999, y: 0.5 }, { x: 1, y: 0.5 }, 0.02);
    expect(next).toEqual({ x: 1, y: 0.5, settled: true });
  });

  it("settles eventually from any start, so the frame loop can stop", () => {
    let pos = { x: -1, y: 1 };
    let frames = 0;
    for (; frames < 10_000; frames++) {
      const next = followStep(pos, { x: 0.3, y: -0.2 }, 0.02);
      pos = next;
      if (next.settled) break;
    }
    expect(frames).toBeLessThan(10_000);
  });
});
