import type { LifeGrid } from "./life-grid.js";

/**
 * Advance a per-cell brightness trail by one generation, in place.
 *
 * `trail` holds one byte per cell, row-major like the grid. Live cells go to
 * full brightness; every other cell keeps `fade` (0..1) of what it had, so a
 * dying cell dims out over a few generations instead of vanishing. Returns
 * whether any cell is still lit.
 */
export function advanceTrail(trail: Uint8Array, grid: LifeGrid, fade: number): boolean {
  let lit = false;
  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const i = y * grid.cols + x;
      const value = grid.get(x, y) ? 255 : Math.floor(trail[i]! * fade);
      trail[i] = value;
      if (value > 0) lit = true;
    }
  }
  return lit;
}
