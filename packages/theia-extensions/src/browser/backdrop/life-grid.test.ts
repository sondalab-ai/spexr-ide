import { describe, expect, it } from "vitest";
import { LifeGrid, SPECIES, gridSizeFor, sprinklePatches } from "./life-grid.js";

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
    // A blinker flips 4 cells a generation, under the default floor of 2% of 1,600.
    const grid = gridWith(40, 40, [[30, 31], [31, 31], [32, 31]], () => 0.1);
    for (let i = 0; i < 3; i++) grid.step();
    expect(grid.population).toBe(3);
    grid.step();
    expect(grid.population).toBeGreaterThan(3);
  });
});

describe("LifeGrid activity stall", () => {
  it("sprinkles when a lone glider is all that moves on a large board", () => {
    // A glider changes a handful of cells a generation, far below 1% of 10,000.
    const glider: Array<[number, number]> = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
    const grid = new LifeGrid(100, 100, { random: () => 0.99, stallLimit: 3, activity: 0.01 });
    grid.clear();
    for (const [x, y] of glider) grid.set(x, y, true);
    for (let i = 0; i < 3; i++) grid.step();
    expect(grid.population).toBe(5);
    const sprinkled = new LifeGrid(100, 100, { random: () => 0.1, stallLimit: 3, activity: 0.01 });
    sprinkled.clear();
    for (const [x, y] of glider) sprinkled.set(x, y, true);
    for (let i = 0; i < 4; i++) sprinkled.step();
    expect(sprinkled.population).toBeGreaterThan(5);
  });

  it("keeps going while the board is busier than the activity floor", () => {
    let n = 7;
    const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const grid = new LifeGrid(60, 60, { random, stallLimit: 2, activity: 0.0001, density: 0.3 });
    const before = grid.population;
    grid.step();
    grid.step();
    grid.step();
    // A dense random soup churns far above the floor, so nothing is added: it thins out.
    expect(grid.population).toBeLessThan(before);
  });
});

describe("sprinklePatches", () => {
  it("adds one patch to a small board and more to a large one", () => {
    expect(sprinklePatches(40, 40)).toBe(1);
    expect(sprinklePatches(400, 250)).toBeGreaterThanOrEqual(4);
  });
});

describe("LifeGrid species", () => {
  function speciesGrid(live: ReadonlyArray<readonly [number, number, number]>): LifeGrid {
    const grid = new LifeGrid(8, 8, { random: () => 0.99, stallLimit: 99 });
    grid.clear();
    for (const [x, y, s] of live) grid.set(x, y, true, s);
    return grid;
  }

  it("gives a newborn the species two of its three parents share", () => {
    // A horizontal blinker: (3,2) and (3,4) are each born of the three cells in the row.
    const grid = speciesGrid([[2, 3, 1], [3, 3, 1], [4, 3, 2]]);
    grid.step();
    expect(grid.get(3, 2) && grid.get(3, 4)).toBe(true);
    expect(grid.speciesAt(3, 2)).toBe(1);
    expect(grid.speciesAt(3, 4)).toBe(1);
  });

  it("gives a newborn of three different parents the species none of them has", () => {
    const grid = speciesGrid([[2, 3, 0], [3, 3, 1], [4, 3, 2]]);
    grid.step();
    expect(grid.speciesAt(3, 2)).toBe(3);
  });

  it("keeps a survivor's species, and a dead cell's for its trail", () => {
    const grid = speciesGrid([[2, 3, 0], [3, 3, 1], [4, 3, 2]]);
    grid.step();
    expect(grid.speciesAt(3, 3)).toBe(1);
    expect(grid.get(2, 3)).toBe(false);
    expect(grid.speciesAt(2, 3)).toBe(0);
  });

  it("fills a sprinkled patch with a single species", () => {
    // After the seed, the first draws place the patch and pick species 2 (0.6 * 4 = 2.4); the rest fill it.
    let draws: number[] = [];
    const grid = new LifeGrid(40, 40, { random: () => draws.shift() ?? 0.1 });
    grid.clear();
    draws = [0.1, 0.1, 0.6];
    grid.sprinkle();
    const seen = new Set<number>();
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) if (grid.get(x, y)) seen.add(grid.speciesAt(x, y));
    expect([...seen]).toEqual([2]);
  });

  it("seeds the board in regions of several species", () => {
    let n = 3;
    const random = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
    const grid = new LifeGrid(60, 60, { random });
    const seen = new Set<number>();
    for (let y = 0; y < 60; y++) for (let x = 0; x < 60; x++) if (grid.get(x, y)) seen.add(grid.speciesAt(x, y));
    expect(seen.size).toBeGreaterThan(1);
    for (const s of seen) expect(s).toBeLessThan(SPECIES);
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

// A panel opened in the background measures 0 wide; a 0-sized board made a
// 0-sized ImageData, which threw and unmounted the Spec panel (E2E, #55).
describe("gridSizeFor", () => {
  it("covers the box, rounding a partial cell up", () => {
    expect(gridSizeFor(10, 9, 4)).toEqual({ cols: 3, rows: 3 });
  });

  it("never sizes a hidden panel's board to zero, and agrees with LifeGrid", () => {
    const size = gridSizeFor(0, 0, 4);
    expect(size).toEqual({ cols: 1, rows: 1 });
    const grid = new LifeGrid(size.cols, size.rows);
    expect([grid.cols, grid.rows]).toEqual([size.cols, size.rows]);
  });
});
