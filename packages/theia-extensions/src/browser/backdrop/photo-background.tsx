import * as React from "@theia/core/shared/react";
import { cover, dotFrame, sampleDots, settledFrame, type Dot } from "@spexr/ui-kit/halftone";
import { CURATED } from "./photo-set.js";
import { PhotoFeed, type Photo, type PhotoCredit, type PhotoSource } from "./photo-feed.js";
import { squareFor } from "./photo-geometry.js";
import {
  MOTION_ATTRIBUTE,
  POWER_SAVE_ATTRIBUTE,
  isMotionPaused,
  isPowerSaving,
} from "../power/power-save-dom.js";

/** Cells per side, the gather's length, and the tick after it. */
const GRID = 128;
const GATHER_MS = 1900;
const TICK_MS = 120;
/** Photos tried in a row before a rotation gives up until the next one, and how long one may take. */
const TRIES = 5;
const LOAD_TIMEOUT_MS = 15_000;

/** Decode a picture, crop its centred square, and return its bytes at twice the grid. */
async function loadPixels(url: string): Promise<Uint8ClampedArray> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      img.decode(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error("timed out")), LOAD_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    img.src = ""; // Stop a download still running after the timeout.
    throw e;
  } finally {
    clearTimeout(timeout);
  }
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

interface Ready {
  readonly photo: Photo;
  readonly pixels: Uint8ClampedArray;
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
 * A new photo every `intervalMs`, from `source` (photo-feed.ts), never one
 * already shown this session while there are new ones; one that fails to load
 * is skipped, and the curated set stands in while the network is out. The
 * photo's credit sits under it, in a layer above the panel's content so its
 * links can be clicked. Colour is the canvas's `color`, and the dots always
 * print the picture's light, whatever the ink. The clock stops while the panel
 * or window is hidden, while motion is paused or power is saved, and resumes
 * where it stopped; reduced motion draws the settled picture; high contrast
 * draws nothing.
 */
export const PhotoBackground = React.memo(function PhotoBackground({
  source,
  intervalMs,
}: {
  readonly source: PhotoSource;
  readonly intervalMs: number;
}): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const creditRef = React.useRef<HTMLDivElement>(null);
  const [credit, setCredit] = React.useState<PhotoCredit | undefined>(undefined);
  // A key that changes only when the source's content does: the choice is re-read, as a new
  // object, whenever any backdrop preference changes.
  const sourceKey = React.useMemo(() => JSON.stringify(source), [source]);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const creditBox = creditRef.current;
    const host = canvas?.parentElement?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !creditBox || !host || !ctx) return undefined;
    const feed = new PhotoFeed({ source: JSON.parse(sourceKey) as PhotoSource, fallback: CURATED });

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    let disposed = false;
    let loading = false;
    let upcoming: Promise<Ready | undefined> | undefined;
    let dots: Dot[] = [];
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

    /** Re-read the ink, which the theme sets through CSS. */
    const retint = (): void => {
      ink = getComputedStyle(canvas).color;
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

    /** The next photo that loads, with its pixels; skips up to TRIES that fail. */
    const fetchNext = async (): Promise<Ready | undefined> => {
      for (let tries = 0; tries < TRIES && !disposed; tries++) {
        const photo = await feed.next();
        if (!photo.url) return undefined;
        try {
          return { photo, pixels: await loadPixels(photo.url) };
        } catch {
          // Unreadable or too slow: the next one.
        }
      }
      return undefined;
    };

    /**
     * Show the photo fetched ahead (or fetch one now), then fetch the one
     * after it, so the next rotation is instant.
     */
    const advance = async (): Promise<void> => {
      if (loading) return;
      loading = true;
      try {
        const ready = await (upcoming ?? fetchNext());
        upcoming = undefined;
        if (disposed) return;
        if (ready) {
          show(ready.pixels);
          setCredit(ready.photo.credit);
          feed.shown(ready.photo);
        }
        upcoming = fetchNext();
      } finally {
        loading = false;
      }
    };

    /** Sample a picture's pixels and start its gather. */
    const show = (pixels: Uint8ClampedArray): void => {
      // Always the picture's light, in any ink: sci-fi photos are mostly light
      // subjects on dark fields, and inverted, their sky prints as a solid blot.
      dots = sampleDots(pixels, GRID * 2, { grid: GRID });
      retint();
      halt();
      const now = performance.now();
      // Loaded while paused: hold it gathered rather than as scattered dust.
      t0 = running() ? now : now - GATHER_MS;
      pausedAt = running() ? null : now;
      sync();
    };

    const resize = (): void => {
      const { side: s, left, top } = squareFor(host.clientWidth, host.clientHeight);
      side = s;
      canvas.style.width = canvas.style.height = `${s}px`;
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      creditBox.style.width = `${host.clientWidth}px`;
      creditBox.style.top = `${host.clientHeight}px`;
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
    theme.observe(root, {
      attributes: true,
      attributeFilter: ["data-sl-theme", POWER_SAVE_ATTRIBUTE, MOTION_ATTRIBUTE],
    });
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", restyle);
    // A new photo only while someone is looking, so a paused window does not gather unseen.
    const rotation = setInterval(() => {
      if (running()) void advance();
    }, intervalMs);

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
  }, [sourceKey, intervalMs]);

  return (
    <>
      <div className="spexr-photo-bg" aria-hidden="true">
        <canvas ref={canvasRef} className="spexr-photo-bg__canvas" />
      </div>
      <div className="spexr-photo-bg spexr-photo-bg--credit">
        <div ref={creditRef} className="spexr-photo-bg__credit">
          {credit && <CreditLine credit={credit} />}
        </div>
      </div>
    </>
  );
});

/** "Photo by X on Unsplash", or "Photo: X · CC BY-SA 2.0 · via Openverse", linked where the source gives links. */
function CreditLine({ credit }: { readonly credit: PhotoCredit }): React.ReactElement {
  const link = (label: string, href: string | undefined): React.ReactNode =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
      </a>
    ) : (
      label
    );
  if (credit.via === "Unsplash") {
    return (
      <span>
        Photo by {link(credit.author, credit.authorUrl)} on {link("Unsplash", credit.viaUrl)}
      </span>
    );
  }
  return (
    <span>
      Photo: {link(credit.author, credit.authorUrl ?? credit.pageUrl)}
      {credit.license && <> · {link(credit.license, credit.pageUrl)}</>} · via{" "}
      {link(credit.via, credit.viaUrl)}
    </span>
  );
}
