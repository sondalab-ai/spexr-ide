import { describe, expect, it } from "vitest";
import { createLagProbe } from "./loop-lag.js";

describe("createLagProbe", () => {
  it("reports how much later than the interval each tick ran", () => {
    let t = 0;
    const probe = createLagProbe(1000, () => t);
    t = 1000;
    expect(probe()).toBe(0);
    t = 4500;
    expect(probe()).toBe(2500);
    t = 5500;
    expect(probe()).toBe(0);
  });

  it("uses the monotonic clock by default, so a wall-clock jump is not a stall", () => {
    const realNow = Date.now;
    const probe = createLagProbe(0);
    Date.now = () => realNow() + 792_000; // what waking from a 13-minute sleep looks like
    try {
      expect(probe()).toBeLessThan(750);
    } finally {
      Date.now = realNow;
    }
  });
});
