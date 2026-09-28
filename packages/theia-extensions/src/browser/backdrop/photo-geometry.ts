/**
 * The photo backdrop's square in a host of `width` × `height` px: half the
 * longer side, anchored to the bottom-right corner, so it always spans at
 * least half the host one way. On a host shorter than half its width, `top`
 * is negative and the square rises past the top edge, where the panel clips it.
 */
export function squareFor(width: number, height: number): { side: number; left: number; top: number } {
  const side = Math.round(Math.max(width, height) / 2);
  return { side, left: width - side, top: height - side };
}
