import { describe, expect, it } from "vitest";
import { MOTION_IDLE_MS, motionPaused, msUntilIdle } from "./motion-idle-state.js";

const T = 1_000_000;

describe("motionPaused", () => {
  it("pauses while the window is unfocused, even with recent input", () => {
    expect(motionPaused({ focused: false, hidden: false, lastInputAt: T }, T)).toBe(true);
  });

  it("pauses while the page is hidden", () => {
    expect(motionPaused({ focused: true, hidden: true, lastInputAt: T }, T)).toBe(true);
  });

  it("runs while focused with recent input", () => {
    expect(motionPaused({ focused: true, hidden: false, lastInputAt: T }, T + MOTION_IDLE_MS - 1)).toBe(false);
  });

  it("pauses after 90 s without input", () => {
    expect(MOTION_IDLE_MS).toBe(90_000);
    expect(motionPaused({ focused: true, hidden: false, lastInputAt: T }, T + MOTION_IDLE_MS)).toBe(true);
  });

  it("resumes on input after an idle pause", () => {
    const later = T + 5 * MOTION_IDLE_MS;
    expect(motionPaused({ focused: true, hidden: false, lastInputAt: T }, later)).toBe(true);
    expect(motionPaused({ focused: true, hidden: false, lastInputAt: later }, later)).toBe(false);
  });
});

describe("msUntilIdle", () => {
  it("counts down from the last input", () => {
    expect(msUntilIdle(T, T)).toBe(MOTION_IDLE_MS);
    expect(msUntilIdle(T, T + 10_000)).toBe(MOTION_IDLE_MS - 10_000);
  });

  it("never goes below zero", () => {
    expect(msUntilIdle(T, T + 2 * MOTION_IDLE_MS)).toBe(0);
  });
});
