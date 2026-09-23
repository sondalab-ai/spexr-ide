import { performance } from "node:perf_hooks";

/**
 * Returns a probe that, called once per timer tick, reports how late that tick
 * ran. It reads the monotonic clock, not `Date.now()`: timers and the monotonic
 * clock both stop while the machine sleeps, so a wake-up is not mistaken for a
 * main-thread stall, whereas the wall clock jumps by the whole sleep.
 */
export function createLagProbe(intervalMs: number, clock: () => number = () => performance.now()): () => number {
  let last = clock();
  return () => {
    const now = clock();
    const lag = now - last - intervalMs;
    last = now;
    return Math.round(lag);
  };
}
