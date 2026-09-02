/**
 * How long after a wheel event scrolled the wall a further one still counts as
 * the same gesture. Wide enough to cover trackpad inertia, short enough that a
 * deliberate pause hands the wheel back to whatever is under the pointer.
 */
export const WALL_GESTURE_MS = 250;

/** Fallback line height for wheel events reported in lines rather than pixels. */
const LINE_HEIGHT_PX = 16;

export type WheelRoute = "wall" | "terminal";

/**
 * Who should consume a wheel event: the wall, or the terminal under the pointer.
 *
 * An embedded terminal swallows the wheel whenever its own buffer can scroll, so
 * a wall scroll died the moment a terminal slid under the pointer. A gesture
 * already moving the wall therefore keeps it, wherever the pointer has drifted;
 * a gesture that *starts* over a terminal is meant for that terminal.
 */
export function routeWheel(input: {
  readonly overTerminal: boolean;
  readonly msSinceWallWheel: number;
}): WheelRoute {
  if (!input.overTerminal) return "wall";
  return input.msSinceWallWheel < WALL_GESTURE_MS ? "wall" : "terminal";
}

/**
 * A wheel event's vertical delta in pixels. Trackpads report pixels, but mice
 * often report lines and some report pages, and scrolling by hand means doing
 * the conversion the browser would otherwise have done.
 */
export function wheelDeltaPx(deltaY: number, deltaMode: number, viewportHeight: number): number {
  if (deltaMode === 1) return deltaY * LINE_HEIGHT_PX;
  if (deltaMode === 2) return deltaY * viewportHeight;
  return deltaY;
}
