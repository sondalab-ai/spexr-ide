import * as React from "@theia/core/shared/react";
import { cover, sampleDots, type DotFrame } from "@spexr/ui-kit/halftone";
import { CURATED } from "./photo-set.js";
import { PhotoFeed, type PhotoCredit, type PhotoSource } from "./photo-feed.js";
import { squareFor } from "./photo-geometry.js";
import { GRID, PhotoScene } from "./photo-scene.js";
import { PhotoRotation } from "./photo-rotation.js";
import {
  MOTION_ATTRIBUTE,
  POWER_SAVE_ATTRIBUTE,
  isMotionPaused,
  isPowerSaving,
} from "../power/power-save-dom.js";

/** How long one picture may take to download and decode before it is skipped. */
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

/**
 * A photo printed as halftone dots in the panel's bottom-right corner, behind
 * its content. The alternative to the Game of Life (backdrop.tsx), mounted
 * the same way: first child of the widget's scrolling node.
 *
 * The dots come from the Sondalab kit's halftone core; the clock is SPEXR's
 * (photo-scene.ts), and so is the choice of the next photo (photo-rotation.ts):
 * this component only wires them to the page.
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
    let ink = "";
    let onScreen = true;

    const highContrast = (): boolean => root.getAttribute("data-sl-theme") === "high-contrast";
    const running = (): boolean =>
      onScreen && !document.hidden && !highContrast() && !isPowerSaving() && !isMotionPaused();

    const paint = (frames: readonly DotFrame[] | null, side: number): void => {
      const dpr = window.devicePixelRatio || 1;
      const px = Math.max(1, Math.round(side * dpr));
      if (canvas.width !== px) canvas.width = canvas.height = px;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, side, side);
      if (!frames) return;
      ctx.fillStyle = ink;
      ctx.beginPath();
      for (const f of frames) {
        ctx.moveTo(f.x + f.r, f.y);
        ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      }
      ctx.fill();
    };

    const scene = new PhotoScene({
      now: () => performance.now(),
      requestFrame: (run) => requestAnimationFrame(run),
      cancelFrame: (id) => cancelAnimationFrame(id),
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
      running,
      moving: () => !reduced.matches,
      visible: () => !highContrast(),
      paint,
    });

    const rotation = new PhotoRotation({
      next: () => feed.next(),
      load: loadPixels,
      show: ({ photo, pixels }) => {
        // Always the picture's light, in any ink: sci-fi photos are mostly light
        // subjects on dark fields, and inverted, their sky prints as a solid blot.
        scene.show(sampleDots(pixels, GRID * 2, { grid: GRID }));
        setCredit(photo.credit);
        feed.shown(photo);
      },
    });

    /** Re-read the ink, which the theme sets through CSS. */
    const retint = (): void => {
      ink = getComputedStyle(canvas).color;
    };
    const sync = (): void => scene.sync();

    const resize = (): void => {
      const { side, left, top } = squareFor(host.clientWidth, host.clientHeight);
      canvas.style.width = canvas.style.height = `${side}px`;
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
      creditBox.style.width = `${host.clientWidth}px`;
      creditBox.style.top = `${host.clientHeight}px`;
      scene.resize(side);
    };

    const restyle = (): void => {
      retint();
      resize();
      scene.sync();
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
    const every = setInterval(() => {
      if (running()) void rotation.advance();
    }, intervalMs);

    retint();
    resize();
    void rotation.advance();
    return () => {
      rotation.dispose();
      scene.dispose();
      clearInterval(every);
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
