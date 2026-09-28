import * as React from "@theia/core/shared/react";
import { cover, dotFrame, sampleDots, settledFrame, type Dot } from "@spexr/ui-kit/halftone";
import { nextPhoto } from "./photo-set.js";
import { squareFor } from "./photo-geometry.js";
import { MOTION_ATTRIBUTE, POWER_SAVE_ATTRIBUTE, isMotionPaused, isPowerSaving } from "../power/power-save-dom.js";

/** Cells per side, the gather's length, the tick after it, and how long one photo stays. */
const GRID = 128;
const GATHER_MS = 1900;
const TICK_MS = 120;
const ROTATE_MS = 10 * 60 * 1000;

/** Decode a picture, crop its centred square, and return its bytes at twice the grid. */
async function loadPixels(url: string): Promise<Uint8ClampedArray> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  const size = GRID * 2;
  const off = document.createElement("canvas");
  off.width = off.height = size;
  const g = off.getContext("2d", { willReadFrequently: true });
  if (!g) throw new Error("no 2d context");
  const c = cover(img.naturalWidth, img.naturalHeight);
  g.drawImage(img, c.sx, c.sy, c.s, c.s, 0, 0, size, size);
  // Throws on a picture from another origin that does not allow CORS.
  return g.getImageData(0, 0, size, size).data;
}

/**
 * A photo printed as halftone dots in the panel's bottom-right corner, behind
 * its content. The alternative to the Game of Life (backdrop.tsx), mounted
 * the same way: first child of the widget's scrolling node.
 *
 * The dots come from the Sondalab kit's halftone core; the clock is SPEXR's.
 * The kit's own live halftone repaints every frame while in view, and behind
 * SPEXR's glass each frame re-composites the window, so here the dots gather
 * at the display rate once per photo, then drift at the Life backdrop's tick.
 * A new photo every ten minutes, never the same twice in a row; one that
 * fails to load is skipped. Colour is the canvas's `color`: dark ink prints
 * the picture's dark, light ink its light. The clock stops while the panel
 * or window is hidden, while motion is paused or power is saved, and resumes
 * where it stopped; reduced motion draws the settled picture; high contrast
 * draws nothing.
 */
export const PhotoBackground = React.memo(function PhotoBackground({
  photos,
}: {
  readonly photos: readonly string[];
}): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const photoKey = photos.join("\n");

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement?.parentElement;
    const ctx = canvas?.getContext("2d");
    const list = photoKey ? photoKey.split("\n") : [];
    if (!canvas || !host || !ctx || list.length === 0) return undefined;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    const swatch = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    let disposed = false;
    let photo: string | undefined;
    let pixels: Uint8ClampedArray | undefined;
    let dots: Dot[] = [];
    let dark = false;
    let ink = "";
    let side = 0;
    let t0: number | null = null;
    let pausedAt: number | null = null;
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onScreen = true;

    const highContrast = (): boolean => root.getAttribute("data-sl-theme") === "high-contrast";
    const moving = (): boolean => !reduced.matches;
    const running = (): boolean =>
      onScreen && !document.hidden && !highContrast() && !isPowerSaving() && !isMotionPaused();

    /** Whether a CSS colour is darker than mid-grey, read by painting it: tokens may be oklch(). */
    const isDark = (colour: string): boolean => {
      if (!swatch) return false;
      swatch.clearRect(0, 0, 1, 1);
      swatch.fillStyle = colour;
      swatch.fillRect(0, 0, 1, 1);
      const [r, g, b] = swatch.getImageData(0, 0, 1, 1).data;
      return (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255 < 0.5;
    };

    /** Re-read the ink; resample when its polarity flips or there are no dots yet. */
    const retint = (): void => {
      ink = getComputedStyle(canvas).color;
      const nowDark = isDark(ink);
      if (pixels && (nowDark !== dark || dots.length === 0)) {
        dots = sampleDots(pixels, GRID * 2, { grid: GRID, invert: nowDark });
      }
      dark = nowDark;
    };

    const draw = (now: number): void => {
      const dpr = window.devicePixelRatio || 1;
      const px = Math.max(1, Math.round(side * dpr));
      if (canvas.width !== px) canvas.width = canvas.height = px;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, side, side);
      if (!side || t0 === null || highContrast()) return;
      const t = (now - t0) / 1000;
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (const d of dots) {
        const f = moving() ? dotFrame(d, t, side, GRID) : settledFrame(d, side, GRID);
        if (f.r <= 0) continue;
        ctx.moveTo(f.x + f.r, f.y);
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      }
      ctx.fill();
    };

    const halt = (): void => {
      if (frame) cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
      frame = 0;
      timer = undefined;
    };

    /** Draw now, then schedule the next frame: every frame while gathering, then every tick. */
    const tick = (): void => {
      frame = 0;
      timer = undefined;
      const now = performance.now();
      draw(now);
      if (!moving() || !running() || t0 === null) return;
      if (now - t0 < GATHER_MS) frame = requestAnimationFrame(tick);
      else timer = setTimeout(tick, TICK_MS);
    };

    /** Start, stop or redraw after anything that changes whether the clock runs. */
    const sync = (): void => {
      const now = performance.now();
      if (running()) {
        if (pausedAt !== null && t0 !== null) t0 += now - pausedAt;
        pausedAt = null;
        if (!frame && timer === undefined) tick();
      } else {
        if (pausedAt === null) pausedAt = now;
        halt();
        draw(pausedAt);
      }
    };

    /** Load the next photo (skipping any that fail) and start its gather. */
    const advance = async (): Promise<void> => {
      for (let tries = 0; tries < list.length; tries++) {
        const next = nextPhoto(list, photo);
        photo = next;
        if (next === undefined) return;
        try {
          const loaded = await loadPixels(next);
          if (disposed) return;
          pixels = loaded;
          dots = [];
          retint();
          halt();
          const now = performance.now();
          // Loaded while paused: hold it gathered rather than as scattered dust.
          t0 = running() ? now : now - GATHER_MS;
          pausedAt = running() ? null : now;
          sync();
          return;
        } catch {
          if (disposed) return;
        }
      }
    };

    const resize = (): void => {
      const { side: s, left, top } = squareFor(host.clientWidth, host.clientHeight);
      side = s;
      canvas.style.width = canvas.style.height = `${s}px`;
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      draw(pausedAt ?? performance.now());
    };

    const restyle = (): void => {
      retint();
      resize();
      sync();
    };

    const sizeObserver = new ResizeObserver(resize);
    sizeObserver.observe(host);
    const visibility = new IntersectionObserver((entries) => {
      onScreen = entries.some((e) => e.isIntersecting);
      sync();
    });
    visibility.observe(host);
    const theme = new MutationObserver(restyle);
    theme.observe(root, { attributes: true, attributeFilter: ["data-sl-theme", POWER_SAVE_ATTRIBUTE, MOTION_ATTRIBUTE] });
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", restyle);
    // A new photo only while someone is looking, so a paused window does not gather unseen.
    const rotation = setInterval(() => {
      if (running()) void advance();
    }, ROTATE_MS);

    resize();
    void advance();
    return () => {
      disposed = true;
      halt();
      clearInterval(rotation);
      sizeObserver.disconnect();
      visibility.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", restyle);
    };
  }, [photoKey]);

  return (
    <div className="spexr-photo-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="spexr-photo-bg__canvas" />
    </div>
  );
});
