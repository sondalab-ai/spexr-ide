/** Below this the eased position rounds to the same `toFixed(4)` value the CSS sees. */
const SETTLE_EPSILON = 5e-5;

/**
 * One frame of the welcome backdrop easing toward the pointer: `rate` of the
 * remaining gap per frame. Snaps onto the target and reports `settled` once the
 * gap no longer shows, so the frame loop can stop instead of rewriting the same
 * values every frame for as long as the page is open.
 */
export function followStep(
  current: { x: number; y: number },
  target: { x: number; y: number },
  rate: number,
): { x: number; y: number; settled: boolean } {
  const x = current.x + (target.x - current.x) * rate;
  const y = current.y + (target.y - current.y) * rate;
  if (Math.abs(target.x - x) < SETTLE_EPSILON && Math.abs(target.y - y) < SETTLE_EPSILON) {
    return { x: target.x, y: target.y, settled: true };
  }
  return { x, y, settled: false };
}
