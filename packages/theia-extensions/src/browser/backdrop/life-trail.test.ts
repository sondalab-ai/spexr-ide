import { describe, expect, it } from "vitest";
import { advanceTrail } from "./life-trail.js";
import { LifeGrid } from "./life-grid.js";

function gridWith(live: ReadonlyArray<readonly [number, number]>): LifeGrid {
  const grid = new LifeGrid(4, 1, { random: () => 0.99 });
  grid.clear();
  for (const [x, y] of live) grid.set(x, y, true);
  return grid;
}

describe("advanceTrail", () => {
  it("lights live cells fully", () => {
    const trail = new Uint8Array(4);
    advanceTrail(trail, gridWith([[1, 0], [3, 0]]), 0.5);
    expect([...trail]).toEqual([0, 255, 0, 255]);
  });

  it("fades a dead cell by the given share each generation", () => {
    const trail = Uint8Array.from([255, 100, 1, 0]);
    advanceTrail(trail, gridWith([]), 0.5);
    expect([...trail]).toEqual([127, 50, 0, 0]);
  });

  it("relights a fading cell that is born again", () => {
    const trail = Uint8Array.from([40, 0, 0, 0]);
    advanceTrail(trail, gridWith([[0, 0]]), 0.5);
    expect(trail[0]).toBe(255);
  });

  it("reports whether anything is still visible", () => {
    expect(advanceTrail(Uint8Array.from([1, 0, 0, 0]), gridWith([]), 0.5)).toBe(false);
    expect(advanceTrail(Uint8Array.from([4, 0, 0, 0]), gridWith([]), 0.5)).toBe(true);
  });
});
