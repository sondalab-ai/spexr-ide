import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MOTION_IDLE_MS } from "./motion-idle-state.js";
import { watchMotionIdle } from "./motion-idle-watch.js";

/** An EventTarget that records how many listeners are attached. */
class FakeTarget extends EventTarget {
  listeners = 0;
  override addEventListener(...args: Parameters<EventTarget["addEventListener"]>): void {
    this.listeners++;
    super.addEventListener(...args);
  }
  override removeEventListener(...args: Parameters<EventTarget["removeEventListener"]>): void {
    this.listeners--;
    super.removeEventListener(...args);
  }
}

class FakeDocument extends FakeTarget {
  focus = true;
  hidden = false;
  hasFocus(): boolean {
    return this.focus;
  }
}

function setup() {
  const win = new FakeTarget();
  const doc = new FakeDocument();
  const applied: boolean[] = [];
  const stop = watchMotionIdle(win as unknown as Window, doc as unknown as Document, (p) => applied.push(p));
  return { win, doc, applied, stop };
}

describe("watchMotionIdle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("pauses on blur once hasFocus confirms the window lost focus", () => {
    const { win, doc, applied } = setup();
    doc.focus = false;
    win.dispatchEvent(new Event("blur"));
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(applied).toEqual([true]);
  });

  it("stays running when focus only moved into an iframe", () => {
    const { win, applied } = setup();
    win.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(0);
    expect(applied).toEqual([]);
  });

  it("does not resume on a pointer move while unfocused, and resumes on focus", () => {
    const { win, doc, applied } = setup();
    doc.focus = false;
    win.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(0);
    win.dispatchEvent(new Event("pointermove"));
    expect(applied).toEqual([true]);
    doc.focus = true;
    win.dispatchEvent(new Event("focus"));
    expect(applied).toEqual([true, false]);
  });

  it("pauses after the idle window and resumes on input", () => {
    const { win, applied } = setup();
    vi.advanceTimersByTime(MOTION_IDLE_MS - 1);
    expect(applied).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(applied).toEqual([true]);
    win.dispatchEvent(new Event("keydown"));
    expect(applied).toEqual([true, false]);
  });

  it("pauses while the page is hidden", () => {
    const { doc, applied } = setup();
    doc.hidden = true;
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(applied).toEqual([true]);
  });

  it("removes every listener and timer on stop", () => {
    const { win, doc, applied, stop } = setup();
    doc.focus = false;
    win.dispatchEvent(new Event("blur"));
    stop();
    expect(win.listeners).toBe(0);
    expect(doc.listeners).toBe(0);
    vi.advanceTimersByTime(10 * MOTION_IDLE_MS);
    expect(applied).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
