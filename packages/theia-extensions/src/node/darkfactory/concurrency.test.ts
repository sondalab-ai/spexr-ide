import { describe, expect, it } from "vitest";
import { forEachConcurrent } from "./concurrency.js";

describe("forEachConcurrent", () => {
  it("visits every item and never exceeds the limit", async () => {
    const seen: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await forEachConcurrent([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      seen.push(n);
      inFlight -= 1;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("does nothing for an empty list", async () => {
    await expect(forEachConcurrent([], 4, async () => {})).resolves.toBeUndefined();
  });
});
