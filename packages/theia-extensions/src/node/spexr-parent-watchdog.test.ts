import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SpexrParentWatchdog, type WatchedProcess } from "./spexr-parent-watchdog.js";

/** Fake `process`: `ppid` is writable and the disconnect listener is callable. */
function makeProcess(options: { ppid?: number; withIpc?: boolean } = {}): WatchedProcess & {
  ppid: number;
  disconnect: () => void;
  signals: Array<{ pid: number; signal: string }>;
} {
  const listeners: Array<() => void> = [];
  return {
    pid: 4242,
    ppid: options.ppid ?? 100,
    ...(options.withIpc === false ? {} : { send: (): void => {} }),
    signals: [] as Array<{ pid: number; signal: string }>,
    on(_event: "disconnect", listener: () => void) {
      listeners.push(listener);
      return this;
    },
    kill(pid: number, signal: string) {
      this.signals.push({ pid, signal });
      return true;
    },
    disconnect() {
      for (const listener of listeners) listener();
    },
  };
}

describe("SpexrParentWatchdog", () => {
  let watchdog: SpexrParentWatchdog;

  beforeEach(() => {
    vi.useFakeTimers();
    watchdog = new SpexrParentWatchdog();
  });

  afterEach(() => {
    watchdog.stop();
    vi.useRealTimers();
  });

  test("terminates the backend when the IPC channel to the parent closes", () => {
    const proc = makeProcess();
    watchdog.watch(proc);
    proc.disconnect();
    expect(proc.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
  });

  test("terminates the backend once it has been reparented to init", () => {
    const proc = makeProcess();
    watchdog.watch(proc, 1000);
    vi.advanceTimersByTime(1000);
    expect(proc.signals).toEqual([]);
    proc.ppid = 1;
    vi.advanceTimersByTime(1000);
    expect(proc.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
  });

  test("polls for an orphan even without an IPC channel (--no-cluster)", () => {
    const proc = makeProcess({ ppid: 1, withIpc: false });
    watchdog.watch(proc, 1000);
    vi.advanceTimersByTime(1000);
    expect(proc.signals).toEqual([{ pid: 4242, signal: "SIGTERM" }]);
  });

  test("signals only once, however many times the poll fires afterwards", () => {
    const proc = makeProcess({ ppid: 1 });
    watchdog.watch(proc, 1000);
    vi.advanceTimersByTime(5000);
    expect(proc.signals).toHaveLength(1);
  });

  test("raises SIGTERM rather than exiting, so Theia's own shutdown runs", () => {
    const proc = makeProcess();
    watchdog.watch(proc);
    proc.disconnect();
    expect(proc.signals[0]?.signal).toBe("SIGTERM");
  });

  test("stops polling once stopped", () => {
    const proc = makeProcess();
    watchdog.watch(proc, 1000);
    watchdog.stop();
    proc.ppid = 1;
    vi.advanceTimersByTime(5000);
    expect(proc.signals).toEqual([]);
  });
});
