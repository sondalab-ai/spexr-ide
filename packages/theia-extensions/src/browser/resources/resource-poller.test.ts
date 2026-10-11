import { describe, expect, it } from "vitest";
import { ResourcePoller, type PollerDeps } from "./resource-poller.js";

/** A poller over fakes: `samples` are answered by hand, timers by `tick`. */
function make(over: Partial<PollerDeps<number>> = {}) {
  const log: string[] = [];
  const pending: Array<(u: number | undefined) => void> = [];
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const deps: PollerDeps<number> = {
    sample: () => new Promise((resolve) => pending.push(resolve)),
    show: (u) => void log.push(`show ${u}`),
    clear: () => void log.push("clear"),
    interval: () => 1000,
    hidden: () => false,
    schedule: (run) => (timers.set(nextTimer, run), nextTimer++),
    cancel: (h) => void timers.delete(h as number),
    ...over,
  };
  const poller = new ResourcePoller(deps);
  const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  const tick = (): void => {
    const [id, run] = [...timers][0] ?? [];
    if (id !== undefined) {
      timers.delete(id);
      run!();
    }
  };
  return { poller, log, pending, timers, flush, tick };
}

describe("the resource meter's loop (S6d, D14)", () => {
  it("does nothing while the preference is off, which is the default", async () => {
    const { poller, pending, log } = make();
    poller.setEnabled(false);
    await Promise.resolve();
    expect(pending.length).toBe(0);
    expect(log).toEqual([]);
  });

  it("samples, shows the sample and schedules the next turn", async () => {
    const { poller, pending, log, flush, timers } = make();
    poller.setEnabled(true);
    pending[0]!(42);
    await flush();
    expect(log).toEqual(["show 42"]);
    expect(timers.size).toBe(1);
  });

  it("leaves exactly one loop when turned off and on again while a sample is in flight, and drops the stale sample", async () => {
    const { poller, pending, log, flush, timers } = make();
    poller.setEnabled(true); // first loop, sample 0 in flight
    poller.setEnabled(false);
    poller.setEnabled(true); // second loop, sample 1 in flight
    expect(pending.length).toBe(2);
    pending[0]!(1); // the stale sample comes back first
    await flush();
    expect(log).toEqual(["clear"]); // nothing shown from the closed generation; only the stop's clear
    expect(timers.size).toBe(0); // and it started no timer
    pending[1]!(2);
    await flush();
    expect(log).toEqual(["clear", "show 2"]);
    expect(timers.size).toBe(1);
  });

  it("can be stopped by the preference after any number of restarts: no timer survives", async () => {
    const { poller, pending, flush, timers } = make();
    for (let i = 0; i < 3; i++) {
      poller.setEnabled(true);
      poller.setEnabled(false);
    }
    poller.setEnabled(true);
    pending[pending.length - 1]!(7);
    await flush();
    expect(timers.size).toBe(1);
    poller.setEnabled(false);
    expect(timers.size).toBe(0);
    for (const resolve of pending) resolve(9);
    await flush();
    expect(timers.size).toBe(0);
  });

  it("skips a turn while the window is hidden, and asks again after the interval", async () => {
    const { poller, pending, timers, tick, log, flush } = make({ hidden: () => true });
    poller.setEnabled(true);
    await flush();
    expect(pending.length).toBe(0);
    expect(log).toEqual([]);
    expect(timers.size).toBe(1);
    tick();
    await flush();
    expect(timers.size).toBe(1);
  });

  it("clears the entry where usage cannot be measured", async () => {
    const { poller, pending, log, flush } = make();
    poller.setEnabled(true);
    pending[0]!(undefined);
    await flush();
    expect(log).toEqual(["clear"]);
  });
});
