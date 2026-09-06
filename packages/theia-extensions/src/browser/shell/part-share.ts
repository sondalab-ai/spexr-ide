/**
 * How much of a Theia view container one of its sections is allowed to take.
 *
 * Kept free of Theia imports so it can be unit-tested without the browser DI
 * runtime: importing anything from `@theia/core/lib/browser` pulls in Lumino,
 * which touches `document` at import time. The side that does touch Theia lives
 * in apply-part-share.ts.
 */

/**
 * How far over its share a section may measure before it is resized. Small on
 * purpose: the caller passes a size with the part's header already taken off
 * (the way Theia's own `doStoreState` does), so what is left to absorb is
 * rounding, not a systematic overshoot.
 */
export const SHARE_SLACK = 0.02;

/**
 * Whether a section is taller than its share, and so worth resizing.
 *
 * `size` is the section's content height, without its header — the same measure
 * `available` is expressed in, so the ratio is directly comparable to the weight
 * that produced it.
 *
 * A section with no size of its own (never laid out, or freshly revealed) counts
 * as over: it is about to be given the average weight of its neighbours, which
 * is exactly the case this exists to correct. An unmeasured container (`available`
 * of 0) counts as under — nothing can be decided yet, and the caller should wait
 * rather than resize against a size of zero.
 */
export function exceedsShare(
  size: number | undefined,
  available: number,
  share: number,
  slack: number = SHARE_SLACK,
): boolean {
  if (available <= 0) return false;
  if (size === undefined || size <= 0) return true;
  return size / available > share + slack;
}

/**
 * Weights for `ViewContainerLayout.setPartSizes`, giving the part at `index` the
 * share it is capped to and splitting the rest evenly between the others.
 *
 * `sizeable[i]` is whether part `i` takes part in the split at all — a hidden or
 * collapsed part does not, and gets `undefined` so the layout keeps ignoring it.
 * The result is all-`undefined` when there is nothing to size (an out-of-range
 * index, or fewer than two participating parts); callers should skip the layout
 * call in that case rather than ask it to redistribute nothing.
 */
export function partShareWeights(
  sizeable: readonly boolean[],
  index: number,
  share: number,
): (number | undefined)[] {
  const none = sizeable.map(() => undefined);
  const counted = sizeable.filter(Boolean).length;
  if (index < 0 || index >= sizeable.length || !sizeable[index] || counted < 2) return none;
  const others = (1 - share) / (counted - 1);
  return sizeable.map((counts, i) => (!counts ? undefined : i === index ? share : others));
}
