/** Number of species a cell can belong to; each is drawn in its own colour. */
export const SPECIES = 4;

/** Board cells per sprinkled patch: a larger board gets more patches at once. */
const CELLS_PER_PATCH = 20_000;

/** Regions the seed paints in species, so the first frame shows colonies rather than confetti. */
const SEED_REGIONS = 6;

export interface LifeGridOptions {
  /** Source of randomness for seeding; `Math.random` in the app, fixed in tests. */
  readonly random?: () => number;
  /** Share of cells alive after a seed, 0..1. */
  readonly density?: number;
  /** Quiet generations tolerated before a sprinkle. */
  readonly stallLimit?: number;
  /**
   * Share of the board, 0..1, that must change in a generation for it to
   * count as active. Changes are measured against both of the last two
   * generations, and the smaller counts, so blinkers read as quiet.
   */
  readonly activity?: number;
}

/**
 * Conway's Game of Life on a wrapping grid that keeps itself going, with
 * every cell belonging to one of `SPECIES` colonies.
 *
 * A newborn takes the species two of its three parents share, or, when all
 * three differ, the one none of them has (the QuadLife rule). Survivors keep
 * theirs, and a dead cell keeps its last one so its fading trail stays in its
 * colour.
 *
 * Instead of reseeding the whole board, which reads as a jump, a quiet board
 * gets random patches of new cells, each of one species: a board that dies
 * out gets them at once, so no step yields an empty frame, and one whose
 * activity stays under the `activity` floor for `stallLimit` generations gets
 * them then. A floor rather than an exact repeat check, because on a large
 * board one glider or slow oscillator anywhere would otherwise keep settled
 * debris on screen indefinitely.
 */
export class LifeGrid {
  readonly cols: number;
  readonly rows: number;
  private cells: Uint8Array;
  private species: Uint8Array;
  private nextSpecies: Uint8Array;
  private previous: Uint8Array | undefined;
  private scratch: Uint8Array;
  private stalled = 0;
  private live = 0;
  private readonly random: () => number;
  private readonly density: number;
  private readonly stallLimit: number;
  private readonly activityFloor: number;

  constructor(cols: number, rows: number, options: LifeGridOptions = {}) {
    this.cols = Math.max(1, Math.floor(cols));
    this.rows = Math.max(1, Math.floor(rows));
    this.random = options.random ?? Math.random;
    this.density = options.density ?? 0.18;
    this.stallLimit = options.stallLimit ?? 24;
    this.activityFloor = (options.activity ?? 0.02) * this.cols * this.rows;
    this.cells = new Uint8Array(this.cols * this.rows);
    this.scratch = new Uint8Array(this.cols * this.rows);
    this.species = new Uint8Array(this.cols * this.rows);
    this.nextSpecies = new Uint8Array(this.cols * this.rows);
    this.seed();
  }

  get population(): number {
    return this.live;
  }

  get(x: number, y: number): boolean {
    return this.cells[y * this.cols + x] === 1;
  }

  /** The cell's species, 0..SPECIES-1: its current one if alive, its last one if dead. */
  speciesAt(x: number, y: number): number {
    return this.species[y * this.cols + x]!;
  }

  set(x: number, y: number, alive: boolean, species?: number): void {
    const i = y * this.cols + x;
    if (species !== undefined) this.species[i] = species % SPECIES;
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

  /**
   * Fill the board afresh at the configured density and forget its history.
   * Species are laid out as a few regions, each cell taking the species of
   * the nearest of `SEED_REGIONS` random centres.
   */
  seed(): void {
    this.clear();
    const centres = Array.from({ length: SEED_REGIONS }, () => ({
      x: this.random() * this.cols,
      y: this.random() * this.rows,
      species: Math.floor(this.random() * SPECIES),
    }));
    for (let i = 0; i < this.cells.length; i++) {
      const x = i % this.cols;
      const y = (i - x) / this.cols;
      let best = Number.POSITIVE_INFINITY;
      for (const c of centres) {
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d < best) {
          best = d;
          this.species[i] = c.species;
        }
      }
      if (this.random() < this.density) {
        this.cells[i] = 1;
        this.live++;
      }
    }
  }

  /**
   * Add live cells in `sprinklePatches` square patches at random spots, each
   * a quarter of the board's shorter side wide (6 to 16 cells) and of one
   * random species. A patch is filled at 35% or the seed density if higher,
   * since a sparse patch dies before it spreads. Existing cells are kept
   * (those a patch lands on join its species), and the stall count starts over.
   */
  sprinkle(): void {
    const side = Math.min(16, Math.max(6, Math.floor(Math.min(this.cols, this.rows) / 4)));
    const fill = Math.max(this.density, 0.35);
    for (let patch = sprinklePatches(this.cols, this.rows); patch > 0; patch--) {
      const left = Math.floor(this.random() * this.cols);
      const top = Math.floor(this.random() * this.rows);
      const species = Math.floor(this.random() * SPECIES);
      for (let dy = 0; dy < side; dy++) {
        for (let dx = 0; dx < side; dx++) {
          if (this.random() < fill) this.set((left + dx) % this.cols, (top + dy) % this.rows, true, species);
        }
      }
    }
    this.previous = undefined;
    this.stalled = 0;
  }

  /** Advance one generation, or sprinkle new cells if the board has been quiet for too long. */
  step(): void {
    if (this.stalled >= this.stallLimit) {
      this.sprinkle();
      return;
    }
    const { cols, rows, cells, species, previous } = this;
    const next = this.scratch;
    const nextSpecies = this.nextSpecies;
    let live = 0;
    let changed = 0;
    let changedSincePrevious = 0;
    for (let y = 0; y < rows; y++) {
      const up = ((y + rows - 1) % rows) * cols;
      const row = y * cols;
      const down = ((y + 1) % rows) * cols;
      for (let x = 0; x < cols; x++) {
        const l = (x + cols - 1) % cols;
        const r = (x + 1) % cols;
        const i = row + x;
        const n =
          cells[up + l]! + cells[up + x]! + cells[up + r]! +
          cells[row + l]! + cells[row + r]! +
          cells[down + l]! + cells[down + x]! + cells[down + r]!;
        const was = cells[i]!;
        const alive = n === 3 || (n === 2 && was === 1) ? 1 : 0;
        next[i] = alive;
        if (alive === 1 && was === 0) {
          const around = NEIGHBOURS;
          around[0] = up + l; around[1] = up + x; around[2] = up + r;
          around[3] = row + l; around[4] = row + r;
          around[5] = down + l; around[6] = down + x; around[7] = down + r;
          nextSpecies[i] = parentSpecies(cells, species, around);
        } else {
          nextSpecies[i] = species[i]!;
        }
        live += alive;
        if (alive !== was) changed++;
        if (previous !== undefined && alive !== previous[i]) changedSincePrevious++;
      }
    }
    this.species = nextSpecies;
    this.nextSpecies = species;
    if (live === 0) {
      this.clear();
      this.sprinkle();
      return;
    }
    const activity = previous === undefined ? changed : Math.min(changed, changedSincePrevious);
    this.stalled = activity <= this.activityFloor ? this.stalled + 1 : 0;
    // Rotate the three buffers: current becomes previous, next becomes current.
    const recycled = previous ?? new Uint8Array(cells.length);
    this.previous = cells;
    this.cells = next;
    this.scratch = recycled;
    this.live = live;
  }
}

/** Scratch for a newborn's neighbour indices, reused so a birth allocates nothing. */
const NEIGHBOURS = new Int32Array(8);

/**
 * The species of a cell born of exactly three live neighbours: the one at
 * least two of them share, or else the one none of them has. `neighbours`
 * holds the eight neighbour indices.
 */
function parentSpecies(cells: Uint8Array, species: Uint8Array, neighbours: Int32Array): number {
  let a = -1;
  let b = -1;
  for (const j of neighbours) {
    if (cells[j] !== 1) continue;
    const s = species[j]!;
    if (a < 0) a = s;
    else if (b < 0) {
      if (s === a) return a;
      b = s;
    } else {
      if (s === a || s === b) return s;
      // Three different species out of four: the missing one is the rest of 0+1+2+3.
      return 6 - a - b - s;
    }
  }
  return Math.max(a, 0);
}

/** How many patches one sprinkle adds to a `cols` x `rows` board: one per `CELLS_PER_PATCH` cells, at least one. */
export function sprinklePatches(cols: number, rows: number): number {
  return Math.max(1, Math.round((cols * rows) / CELLS_PER_PATCH));
}
/**
 * The board for a box of `width` x `height` CSS px at `cellPx` a cell: never
 * smaller than one cell a side. A hidden panel measures 0 wide, and a 0-sized
 * board would make a 0-sized ImageData, which throws.
 */
export function gridSizeFor(width: number, height: number, cellPx: number): { cols: number; rows: number } {
  return { cols: Math.max(1, Math.ceil(width / cellPx)), rows: Math.max(1, Math.ceil(height / cellPx)) };
}
