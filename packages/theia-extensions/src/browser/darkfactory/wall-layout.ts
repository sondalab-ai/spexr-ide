/**
 * How the wall arranges the cards that hold a live terminal.
 * `stack` is one full-width card per session; `mosaic` tiles them side by side.
 */
export type WallLayout = "stack" | "mosaic";

/**
 * Narrowest a mosaic cell may get. An agent terminal below this stops showing a
 * usable line of output (wrapped diffs, truncated tool chips), so it is the floor
 * the column count is derived from rather than a cosmetic minimum.
 */
export const MOSAIC_MIN_CELL_PX = 640;

/** Gap between mosaic cells, in px — mirrors `--sl-space-4` (1rem) in the stylesheet. */
export const MOSAIC_GAP_PX = 16;

/**
 * How many columns the mosaic gets: the available width divided by the number of
 * running terminals, held to {@link MOSAIC_MIN_CELL_PX} per cell. Fewer terminals
 * than fit means fewer, wider columns (two terminals never make three); more
 * terminals than fit means the extra ones wrap onto the next row. Always at least
 * one column, including before the wall has been measured.
 */
export function mosaicColumns(
  availableWidth: number,
  terminalCount: number,
  minCell: number = MOSAIC_MIN_CELL_PX,
  gap: number = MOSAIC_GAP_PX,
): number {
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return 1;
  // n cells need n * minCell of content plus (n - 1) gaps between them.
  const fit = Math.floor((availableWidth + gap) / (minCell + gap));
  return Math.max(1, Math.min(fit, Math.floor(terminalCount)));
}

/** Storage key for the arrangement the user picked. */
export const WALL_LAYOUT_KEY = "spexr.darkfactory.wallLayout";

/** The slice of `localStorage` this module needs, so tests can pass a fake. */
export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored arrangement; `stack` whenever nothing usable is stored. */
export function readWallLayout(storage: LayoutStorage): WallLayout {
  let raw: string | null;
  try {
    raw = storage.getItem(WALL_LAYOUT_KEY);
  } catch {
    return "stack"; // private windows and blocked site data throw on access
  }
  return raw === "mosaic" ? "mosaic" : "stack";
}

/** Persist an arrangement. Storage failures are ignored: the wall still switches. */
export function writeWallLayout(storage: LayoutStorage, layout: WallLayout): void {
  try {
    storage.setItem(WALL_LAYOUT_KEY, layout);
  } catch {
    // ignore
  }
}
