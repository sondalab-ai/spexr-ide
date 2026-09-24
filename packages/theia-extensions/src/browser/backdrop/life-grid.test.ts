import { describe, expect, it } from "vitest";
import { LifeGrid } from "./life-grid.js";

/** A grid with the given live cells and a seed source that never fires. */
function gridWith(cols: number, rows: number, live: ReadonlyArray<readonly [number, number]>, random = () => 0.99) {
  const grid = new LifeGrid(cols, rows, { random, density: 0.2, stallLimit: 3 });
  grid.clear();
  for (const [x, y] of live) grid.set(x, y, true);
  return grid;
}

function liveCells(grid: LifeGrid): string[] {
  const out: string[] = [];
  for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) if (grid.get(x, y)) out.push(`${x},${y}`);
  return out;
}

describe("LifeGrid.step", () => {
  it("keeps a block still", () => {
    const grid = gridWith(6, 6, [[2, 2], [3, 2], [2, 3], [3, 3]]);
    grid.step();
    expect(liveCells(grid)).toEqual(["2,2", "3,2", "2,3", "3,3"]);
  });

  it("flips a blinker between horizontal and vertical", () => {
    const grid = gridWith(7, 7, [[2, 3], [3, 3], [4, 3]]);
    grid.step();
    expect(liveCells(grid)).toEqual(["3,2", "3,3", "3,4"]);
    grid.step();
    expect(liveCells(grid)).toEqual(["2,3", "3,3", "4,3"]);
  });

  it("moves a glider one cell diagonally every four generations", () => {
    const glider: Array<[number, number]> = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
    const grid = gridWith(10, 10, glider);
    for (let i = 0; i < 4; i++) grid.step();
    const moved = gridWith(10, 10, glider.map(([x, y]) => [x + 1, y + 1] as const));
    expect(liveCells(grid)).toEqual(liveCells(moved));
  });

  it("wraps around the edges", () => {
    const grid = gridWith(5, 5, [[4, 2], [0, 2], [1, 2]]);
    grid.step();
    expect(liveCells(grid)).toEqual(["0,1", "0,2", "0,3"]);
  });
});

describe("LifeGrid sprinkling", () => {
  it("sprinkles a patch into a grid that died out, not the whole board", () => {
    const grid = gridWith(40, 40, [[1, 1]], () => 0.1);
    grid.step();
    expect(grid.population).toBeGreaterThan(0);
    expect(grid.population).toBeLessThan(40 * 40 / 4);
  });

  it("sprinkles once a still life has held for the stall limit, keeping it", () => {
    const grid = gridWith(40, 40, [[30, 30], [31, 30], [30, 31], [31, 31]], () => 0.1);
    for (let i = 0; i < 3; i++) grid.step();
    expect(grid.population).toBe(4);
    grid.step();
    expect(grid.population).toBeGreaterThan(4);
    expect(grid.get(30, 30) && grid.get(31, 31)).toBe(true);
  });

  it("treats a period-two oscillator as stalled too", () => {
    // The first flip has no earlier generation to match, so the stall starts a step later.
    const grid = gridWith(40, 40, [[30, 31], [31, 31], [32, 31]], () => 0.1);
    for (let i = 0; i < 4; i++) grid.step();
    expect(grid.population).toBe(3);
    grid.step();
    expect(grid.population).toBeGreaterThan(3);
  });
});

describe("LifeGrid seeding", () => {
  it("seeds at roughly the requested density", () => {
    let n = 0;
    const grid = new LifeGrid(20, 20, { random: () => ((n = (n * 9301 + 49297) % 233280) / 233280), density: 0.25 });
    expect(grid.population / 400).toBeGreaterThan(0.15);
    expect(grid.population / 400).toBeLessThan(0.35);
  });
});
