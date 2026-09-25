import * as React from "@theia/core/shared/react";
import { LifeGrid, SPECIES, gridSizeFor } from "./life-grid.js";
import { advanceTrail } from "./life-trail.js";
import { POWER_SAVE_ATTRIBUTE, isPowerSaving } from "../power/power-save-dom.js";

/** Cell pitch, generation period, and the share of brightness a dead cell keeps per generation. */
const CELL_PX = 4;
const TICK_MS = 120;
const FADE = 0.72;

/**
 * A fine-grained Game of Life drawn behind a panel's content, pinned to its viewport.
 *
 * It exists to give the glass surfaces above it something to bend. Mount it
 * as the first child of the widget's scrolling node, with the content after
 * it. The canvas is sized to that node, so it covers the visible area whatever
 * the scroll offset. Dying cells leave a short fading trail. Each generation is
 * written one pixel per cell into a small offscreen canvas and scaled up with
 * smoothing off, so drawing costs the same however many cells are lit, and the
 * lensed panes re-filter once per tick rather than every frame. It pauses while
 * the window or the panel is hidden, draws a single still frame under reduced
 * motion or while saving power, and draws nothing in high contrast. Strength comes from CSS, and
 * each species' colour from the canvas's `--sl-life-species-<n>` properties.
 */
export const LifeBackground = React.memo(function LifeBackground(): React.ReactElement {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement?.parentElement;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !host || !ctx) return undefined;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    const cellCanvas = document.createElement("canvas");
    const cellCtx = cellCanvas.getContext("2d");
    if (!cellCtx) return undefined;
    let grid: LifeGrid | undefined;
    let trail = new Uint8Array(0);
    let image: ImageData | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let onScreen = true;

    const highContrast = (): boolean => root.getAttribute("data-sl-theme") === "high-contrast";

    let palette: Array<[number, number, number]> = [];

    /** A CSS colour as RGB bytes, resolved by painting it: tokens may be oklch(). */
    const toRgb = (colour: string): [number, number, number] => {
      cellCtx.clearRect(0, 0, 1, 1);
      cellCtx.fillStyle = colour;
      cellCtx.fillRect(0, 0, 1, 1);
      const [r, g, b] = cellCtx.getImageData(0, 0, 1, 1).data;
      return [r!, g!, b!];
    };

    /** Re-read the species colours, falling back to the canvas's text colour. */
    const readPalette = (): void => {
      const style = getComputedStyle(canvas);
      palette = Array.from({ length: SPECIES }, (_, n) =>
        toRgb(style.getPropertyValue(`--sl-life-species-${n}`).trim() || style.color),
      );
    };

    const draw = (): void => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!grid || !image || highContrast()) return;
      const px = image.data;
      for (let y = 0, i = 0; y < grid.rows; y++) {
        for (let x = 0; x < grid.cols; x++, i++) {
          const [r, g, b] = palette[grid.speciesAt(x, y)]!;
          const o = i * 4;
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = b;
          px[o + 3] = trail[i]!;
        }
      }
      cellCtx.putImageData(image, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const dpr = window.devicePixelRatio || 1;
      ctx.drawImage(cellCanvas, 0, 0, grid.cols, grid.rows, 0, 0, grid.cols * CELL_PX * dpr, grid.rows * CELL_PX * dpr);
    };

    const resize = (): void => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      const { cols, rows } = gridSizeFor(width, height, CELL_PX);
      if (!grid || grid.cols !== cols || grid.rows !== rows) {
        grid = new LifeGrid(cols, rows);
        trail = new Uint8Array(cols * rows);
        advanceTrail(trail, grid, FADE);
        cellCanvas.width = cols;
        cellCanvas.height = rows;
        image = cellCtx.createImageData(cols, rows);
      }
      draw();
    };

    const running = (): boolean =>
      onScreen && !document.hidden && !reduced.matches && !highContrast() && !isPowerSaving();
    const sync = (): void => {
      if (running() && timer === undefined) {
        timer = setInterval(() => {
          if (!grid) return;
          grid.step();
          advanceTrail(trail, grid, FADE);
          draw();
        }, TICK_MS);
      } else if (!running() && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const restyle = (): void => {
      readPalette();
      draw();
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
    theme.observe(root, { attributes: true, attributeFilter: ["data-sl-theme", POWER_SAVE_ATTRIBUTE] });
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", restyle);

    readPalette();
    resize();
    sync();
    return () => {
      if (timer !== undefined) clearInterval(timer);
      sizeObserver.disconnect();
      visibility.disconnect();
      theme.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reduced.removeEventListener("change", restyle);
    };
  }, []);

  return (
    <div className="spexr-life-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="spexr-life-bg__canvas" />
    </div>
  );
});
