export interface LifeGridOptions {
  /** Source of randomness for seeding; `Math.random` in the app, fixed in tests. */
  readonly random?: () => number;
  /** Share of cells alive after a seed, 0..1. */
  readonly density?: number;
  /** Stalled generations (still life or period-two) tolerated before a sprinkle. */
  readonly stallLimit?: number;
}

/**
 * Conway's Game of Life on a wrapping grid that keeps itself going.
 *
 * Instead of reseeding the whole board, which reads as a jump, a stalled board
 * gets one random patch of new cells: a board that dies out gets it at once,
 * so no step yields an empty frame, and one that settles into still lifes or
 * blinkers gets it after `stallLimit` generations of repeating itself.
 */
export class LifeGrid {
  readonly cols: number;
  readonly rows: number;
  private cells: Uint8Array;
  private previous: Uint8Array | undefined;
  private scratch: Uint8Array;
  private stalled = 0;
  private live = 0;
  private readonly random: () => number;
  private readonly density: number;
  private readonly stallLimit: number;

  constructor(cols: number, rows: number, options: LifeGridOptions = {}) {
    this.cols = Math.max(1, Math.floor(cols));
    this.rows = Math.max(1, Math.floor(rows));
    this.random = options.random ?? Math.random;
    this.density = options.density ?? 0.18;
    this.stallLimit = options.stallLimit ?? 24;
    this.cells = new Uint8Array(this.cols * this.rows);
    this.scratch = new Uint8Array(this.cols * this.rows);
    this.seed();
  }

  get population(): number {
    return this.live;
  }

  get(x: number, y: number): boolean {
    return this.cells[y * this.cols + x] === 1;
  }

  set(x: number, y: number, alive: boolean): void {
    const i = y * this.cols + x;
    const was = this.cells[i] === 1;
    if (was === alive) return;
    this.cells[i] = alive ? 1 : 0;
    this.live += alive ? 1 : -1;
  }

  clear(): void {
    this.cells.fill(0);
    this.previous = undefined;
    this.stalled = 0;
    this.live = 0;
  }

  /** Fill the board afresh at the configured density and forget its history. */
  seed(): void {
    this.clear();
    for (let i = 0; i < this.cells.length; i++) {
      if (this.random() < this.density) {
        this.cells[i] = 1;
        this.live++;
      }
    }
  }

  /**
   * Add live cells in one square patch at a random spot, a quarter of the
   * board's shorter side wide (6 to 16 cells). The patch is filled at 35% or
   * the seed density if higher, since a sparse patch dies before it spreads.
   * Existing cells are kept, and the stall count starts over.
   */
  sprinkle(): void {
    const side = Math.min(16, Math.max(6, Math.floor(Math.min(this.cols, this.rows) / 4)));
    const fill = Math.max(this.density, 0.35);
    const left = Math.floor(this.random() * this.cols);
    const top = Math.floor(this.random() * this.rows);
    for (let dy = 0; dy < side; dy++) {
      for (let dx = 0; dx < side; dx++) {
        if (this.random() < fill) this.set((left + dx) % this.cols, (top + dy) % this.rows, true);
      }
    }
    this.previous = undefined;
    this.stalled = 0;
  }

  /** Advance one generation, or sprinkle new cells if the board has stalled for too long. */
  step(): void {
    if (this.stalled >= this.stallLimit) {
      this.sprinkle();
      return;
    }
    const { cols, rows, cells } = this;
    const next = this.scratch;
    let live = 0;
    for (let y = 0; y < rows; y++) {
      const up = ((y + rows - 1) % rows) * cols;
      const row = y * cols;
      const down = ((y + 1) % rows) * cols;
      for (let x = 0; x < cols; x++) {
        const l = (x + cols - 1) % cols;
        const r = (x + 1) % cols;
        const n =
          cells[up + l]! + cells[up + x]! + cells[up + r]! +
          cells[row + l]! + cells[row + r]! +
          cells[down + l]! + cells[down + x]! + cells[down + r]!;
        const alive = n === 3 || (n === 2 && cells[row + x] === 1) ? 1 : 0;
        next[row + x] = alive;
        live += alive;
      }
    }
    if (live === 0) {
      this.clear();
      this.sprinkle();
      return;
    }
    const repeats = sameCells(next, cells) || (this.previous !== undefined && sameCells(next, this.previous));
    this.stalled = repeats ? this.stalled + 1 : 0;
    // Rotate the three buffers: current becomes previous, next becomes current.
    const recycled = this.previous ?? new Uint8Array(cells.length);
    this.previous = cells;
    this.cells = next;
    this.scratch = recycled;
    this.live = live;
  }
}

function sameCells(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
