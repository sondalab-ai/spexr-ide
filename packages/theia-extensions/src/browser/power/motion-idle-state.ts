/** How long without input before decorative motion pauses: long enough to watch an agent work hands-off. */
export const MOTION_IDLE_MS = 90_000;

/** What the window knows about its user, as motion-idle.ts tracks it. */
export interface MotionIdleState {
  focused: boolean;
  hidden: boolean;
  lastInputAt: number;
}

/**
 * Whether decorative motion should stand still at `now`: the window is
 * unfocused or hidden, or nobody has touched it for {@link MOTION_IDLE_MS}.
 * Input alone never resumes an unfocused window: macOS delivers pointer
 * moves to background windows.
 */
export function motionPaused(state: MotionIdleState, now: number): boolean {
  return !state.focused || state.hidden || msUntilIdle(state.lastInputAt, now) === 0;
}

/** Milliseconds left before the window counts as idle, never negative. */
export function msUntilIdle(lastInputAt: number, now: number): number {
  return Math.max(0, MOTION_IDLE_MS - (now - lastInputAt));
}
