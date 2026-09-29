import { dotFrame, settledFrame, type Dot, type DotFrame } from "@spexr/ui-kit/halftone";

/** Cells per side, the gather's length (longest delay 0.7 s + assemble 1.1 s), and the tick after it. */
export const GRID = 128;
export const GATHER_MS = 1900;
export const TICK_MS = 120;

/** What a scene needs from the page: a clock, a scheduler, the page's state, and a canvas to paint. */
export interface SceneEnv {
  readonly now: () => number;
  readonly requestFrame: (run: () => void) => number;
  readonly cancelFrame: (id: number) => void;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (id: unknown) => void;
  /** Whether the clock may run: shown, not paused, not saving power, not in high contrast. */
  readonly running: () => boolean;
  /** Whether the dots move at all: false under reduced motion. */
  readonly moving: () => boolean;
  /** Whether anything is drawn: false in high contrast. */
  readonly visible: () => boolean;
  /** Paint these dots on a square of `side` px, or clear it for `null`. */
  readonly paint: (frames: readonly DotFrame[] | null, side: number) => void;
}

/**
 * The photo backdrop's clock, kept apart from the DOM so it can be tested.
 * A shown photo gathers at the display rate, then drifts at the Life
 * backdrop's tick. When the clock may not run, the frame holds where it is
 * and resumes from there; under reduced motion the settled picture is drawn
 * once; out of view nothing is drawn.
 */
export class PhotoScene {
  private dots: readonly Dot[] = [];
  private side = 0;
  private t0: number | null = null;
  private pausedAt: number | null = null;
  private frame = 0;
  private timer: unknown;

  constructor(private readonly env: SceneEnv) {}

  /** Start a new picture's gather; one shown while paused is held already gathered. */
  show(dots: readonly Dot[]): void {
    this.dots = dots;
    this.halt();
    const now = this.env.now();
    const running = this.env.running();
    this.t0 = running ? now : now - GATHER_MS;
    this.pausedAt = running ? null : now;
    this.sync();
  }

  /** The square's new side, in px; redraws at the current instant. */
  resize(side: number): void {
    this.side = side;
    this.redraw();
  }

  /** Draw again at the current instant, as after a change of ink. */
  redraw(): void {
    this.draw(this.pausedAt ?? this.env.now());
  }

  /** Start, stop or redraw after anything that changes whether the clock may run. */
  sync(): void {
    const now = this.env.now();
    if (this.env.running()) {
      if (this.pausedAt !== null && this.t0 !== null) this.t0 += now - this.pausedAt;
      this.pausedAt = null;
      if (!this.frame && this.timer === undefined) this.tick();
    } else {
      this.pausedAt ??= now;
      this.halt();
      this.draw(this.pausedAt);
    }
  }

  dispose(): void {
    this.halt();
  }

  private readonly tick = (): void => {
    this.frame = 0;
    this.timer = undefined;
    const now = this.env.now();
    this.draw(now);
    if (!this.env.moving() || !this.env.running() || this.t0 === null) return;
    if (now - this.t0 < GATHER_MS) this.frame = this.env.requestFrame(this.tick);
    else this.timer = this.env.setTimer(this.tick, TICK_MS);
  };

  private halt(): void {
    if (this.frame) this.env.cancelFrame(this.frame);
    if (this.timer !== undefined) this.env.clearTimer(this.timer);
    this.frame = 0;
    this.timer = undefined;
  }

  private draw(now: number): void {
    const { side, t0 } = this;
    if (!side || t0 === null || !this.env.visible()) {
      this.env.paint(null, side);
      return;
    }
    const t = (now - t0) / 1000;
    const moving = this.env.moving();
    const frames: DotFrame[] = [];
    for (const d of this.dots) {
      const f = moving ? dotFrame(d, t, side, GRID) : settledFrame(d, side, GRID);
      if (f.r > 0) frames.push(f);
    }
    this.env.paint(frames, side);
  }
}
