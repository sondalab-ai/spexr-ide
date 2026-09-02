import { describe, expect, it } from "vitest";
import { routeWheel, wheelDeltaPx, WALL_GESTURE_MS } from "./wheel-routing.js";

describe("routeWheel", () => {
  it("gives the wall anything outside a terminal", () => {
    expect(routeWheel({ overTerminal: false, msSinceWallWheel: 10_000 })).toBe("wall");
  });

  it("keeps the wall scrolling when a terminal slides under the pointer mid-gesture", () => {
    expect(routeWheel({ overTerminal: true, msSinceWallWheel: 40 })).toBe("wall");
  });

  it("gives the terminal a gesture that starts over it", () => {
    expect(routeWheel({ overTerminal: true, msSinceWallWheel: 10_000 })).toBe("terminal");
  });

  it("hands the wheel back once the wall gesture has clearly ended", () => {
    expect(routeWheel({ overTerminal: true, msSinceWallWheel: WALL_GESTURE_MS })).toBe("terminal");
  });

  it("still treats the last instant of the window as the same gesture", () => {
    expect(routeWheel({ overTerminal: true, msSinceWallWheel: WALL_GESTURE_MS - 1 })).toBe("wall");
  });
});

describe("wheelDeltaPx", () => {
  it("passes pixel deltas through", () => {
    expect(wheelDeltaPx(120, 0, 800)).toBe(120);
  });

  it("converts line deltas", () => {
    expect(wheelDeltaPx(3, 1, 800)).toBe(48);
  });

  it("converts page deltas against the viewport", () => {
    expect(wheelDeltaPx(2, 2, 800)).toBe(1600);
  });

  it("keeps the direction of an upward scroll", () => {
    expect(wheelDeltaPx(-3, 1, 800)).toBe(-48);
  });
});
