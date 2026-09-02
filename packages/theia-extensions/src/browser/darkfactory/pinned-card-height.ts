/** Storage key for the height the user dragged the pinned card to. */
export const PINNED_HEIGHT_KEY = "spexr.darkfactory.pinnedHeight";

/** Bounds, as a share of the viewport: below the first the card is useless, above the second it hides the grid. */
export const MIN_HEIGHT_VH = 20;
export const MAX_HEIGHT_VH = 90;

/** The slice of `localStorage` this module needs, so tests can pass a fake. */
export interface HeightStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Hold a height inside the viewport-relative bounds, rounded to whole pixels.
 * The bounds are recomputed from the current viewport, so a height stored on a
 * large window shrinks to fit a small one instead of hiding the grid.
 */
export function clampPinnedHeight(px: number, viewportHeight: number): number {
  const min = (viewportHeight * MIN_HEIGHT_VH) / 100;
  const max = (viewportHeight * MAX_HEIGHT_VH) / 100;
  return Math.round(Math.min(Math.max(px, min), max));
}

/**
 * The stored height, clamped to the current viewport; `undefined` when nothing
 * is stored or the value is unusable, which leaves the CSS default in charge.
 */
export function readPinnedHeight(
  storage: HeightStorage,
  viewportHeight: number,
): number | undefined {
  let raw: string | null;
  try {
    raw = storage.getItem(PINNED_HEIGHT_KEY);
  } catch {
    return undefined; // private windows and blocked site data throw on access
  }
  if (raw === null) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return clampPinnedHeight(parsed, viewportHeight);
}

/** Persist a height. Storage failures are ignored: the card still resizes. */
export function writePinnedHeight(storage: HeightStorage, px: number): void {
  try {
    storage.setItem(PINNED_HEIGHT_KEY, String(Math.round(px)));
  } catch {
    // ignore
  }
}
