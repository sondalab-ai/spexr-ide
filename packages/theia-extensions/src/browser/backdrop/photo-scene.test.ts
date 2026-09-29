import { describe, expect, it } from "vitest";
import { dotFrame, settledFrame, type Dot, type DotFrame } from "@spexr/ui-kit/halftone";
import { GATHER_MS, GRID, PhotoScene, TICK_MS } from "./photo-scene.js";

const DOTS: Dot[] = [
  { x: 0.25, y: 0.25, L: 0.8, sx: 0.5, sy: 0.5, delay: 0.1, phase: 0.3 },
  { x: 0.75, y: 0.6, L: 0.5, sx: 0.4, sy: 0.7, delay: 0.6, phase: 1.2 },
];
const SIDE = 400;

/** A page with a hand-driven clock: frames and timers run only when the test says so. */
function page() {
  const state = { now: 1000, running: true, moving: true, visible: true };
  const frames = new Map<number, () => void>();
  const timers = new Map<number, { run: () => void; ms: number }>();
  const painted: Array<readonly DotFrame[] | null> = [];
  let id = 0;
  const scene = new PhotoScene({
    now: () => state.now,
    requestFrame: (run) => (frames.set(++id, run), id),
    cancelFrame: (n) => frames.delete(n),
    setTimer: (run, ms) => (timers.set(++id, { run, ms }), id),
    clearTimer: (n) => timers.delete(n as number),
    running: () => state.running,
    moving: () => state.moving,
    visible: () => state.visible,
    paint: (f) => painted.push(f),
  });
  /** Move the clock to `ms`, then run whatever is due: the pending frame or an elapsed timer. */
  const runAt = (ms: number): void => {
    state.now = ms;
    const [frame] = frames.entries();
    if (frame) {
      frames.delete(frame[0]);
      frame[1]();
      return;
    }
    const [timer] = timers.entries();
    if (timer) {
      timers.delete(timer[0]);
      timer[1].run();
    }
  };
  return { state, scene, frames, timers, painted, runAt, last: () => painted.at(-1) };
}

const at = (t: number): DotFrame[] =>
  DOTS.map((d) => dotFrame(d, t, SIDE, GRID)).filter((f) => f.r > 0);

describe("PhotoScene", () => {
  it("draws nothing before a photo, or without a size", () => {
    const p = page();
    p.scene.resize(SIDE);
    expect(p.last()).toBeNull();
    const q = page();
    q.scene.show(DOTS);
    expect(q.last()).toBeNull();
  });

  it("gathers every frame, then drifts every tick", () => {
    const p = page();
    p.scene.resize(SIDE);
    p.scene.show(DOTS);
    expect(p.last()).toEqual(at(0));
    expect(p.frames.size).toBe(1);

    p.runAt(1000 + 500);
    expect(p.last()).toEqual(at(0.5));
    expect(p.frames.size).toBe(1);

    p.runAt(1000 + GATHER_MS);
    expect(p.frames.size).toBe(0);
    expect([...p.timers.values()].map((t) => t.ms)).toEqual([TICK_MS]);

    p.runAt(1000 + GATHER_MS + TICK_MS);
    expect(p.last()).toEqual(at((GATHER_MS + TICK_MS) / 1000));
    expect(p.timers.size).toBe(1);
  });

  it("holds the frame while paused and resumes from it, however long the pause", () => {
    const p = page();
    p.scene.resize(SIDE);
    p.scene.show(DOTS);
    p.runAt(1000 + GATHER_MS);
    const before = p.last();

    p.state.running = false;
    p.scene.sync();
    expect(p.last()).toEqual(before);
    expect(p.frames.size + p.timers.size).toBe(0);

    p.state.now += 60_000;
    p.scene.redraw();
    expect(p.last()).toEqual(before);

    p.state.running = true;
    p.scene.sync();
    expect(p.last()).toEqual(before);
    expect(p.timers.size).toBe(1);
  });

  it("holds a photo shown while paused already gathered, not as scattered dust", () => {
    const p = page();
    p.scene.resize(SIDE);
    p.state.running = false;
    p.scene.show(DOTS);
    expect(p.last()).toEqual(at(GATHER_MS / 1000));
    expect(p.frames.size + p.timers.size).toBe(0);
  });

  it("draws the settled picture once under reduced motion", () => {
    const p = page();
    p.state.moving = false;
    p.scene.resize(SIDE);
    p.scene.show(DOTS);
    expect(p.last()).toEqual(DOTS.map((d) => settledFrame(d, SIDE, GRID)).filter((f) => f.r > 0));
    expect(p.frames.size + p.timers.size).toBe(0);
  });

  it("clears the square when nothing may be drawn, as in high contrast", () => {
    const p = page();
    p.scene.resize(SIDE);
    p.scene.show(DOTS);
    p.state.visible = false;
    p.state.running = false;
    p.scene.sync();
    expect(p.last()).toBeNull();
  });

  it("restarts the gather for the next photo, and stops everything on dispose", () => {
    const p = page();
    p.scene.resize(SIDE);
    p.scene.show(DOTS);
    p.runAt(1000 + GATHER_MS + TICK_MS);
    p.scene.show(DOTS);
    expect(p.last()).toEqual(at(0));
    expect(p.frames.size).toBe(1);
    expect(p.timers.size).toBe(0);
    p.scene.dispose();
    expect(p.frames.size + p.timers.size).toBe(0);
  });
});
