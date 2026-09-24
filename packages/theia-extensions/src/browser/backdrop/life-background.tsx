import * as React from "@theia/core/shared/react";
import { LifeGrid } from "./life-grid.js";

/** Cell pitch and generation period: coarse and slow, so it reads as texture. */
const CELL_PX = 8;
const TICK_MS = 1100;

/**
 * A slow Game of Life drawn behind a panel's content, pinned to its viewport.
 *
 * It exists to give the glass surfaces above it something to bend. Mount it
 * as the first child of the widget's scrolling node, with the content after
 * it. The canvas is sized to that node, so it covers the visible area whatever
 * the scroll offset. Generations cut rather than fade, which keeps the lensed
 * panes re-filtering once per tick instead of every frame. It pauses while the
 * window or the panel is hidden, draws a single still frame under reduced
 * motion, and draws nothing in high contrast. Colour and strength come from CSS.
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
    let grid: LifeGrid | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let onScreen = true;

    const highContrast = (): boolean => root.getAttribute("data-sl-theme") === "high-contrast";

    const draw = (): void => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!grid || highContrast()) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = getComputedStyle(canvas).color;
      const size = CELL_PX - 1;
      for (let y = 0; y < grid.rows; y++) {
        for (let x = 0; x < grid.cols; x++) {
          if (grid.get(x, y)) ctx.fillRect(x * CELL_PX, y * CELL_PX, size, size);
        }
      }
    };

    const resize = (): void => {
      const width = host.clientWidth;
      const height = host.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      const cols = Math.ceil(width / CELL_PX);
      const rows = Math.ceil(height / CELL_PX);
      if (!grid || grid.cols !== cols || grid.rows !== rows) grid = new LifeGrid(cols, rows);
      draw();
    };

    const running = (): boolean => onScreen && !document.hidden && !reduced.matches && !highContrast();
    const sync = (): void => {
      if (running() && timer === undefined) {
        timer = setInterval(() => {
          grid?.step();
          draw();
        }, TICK_MS);
      } else if (!running() && timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    };
    const restyle = (): void => {
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
    theme.observe(root, { attributes: true, attributeFilter: ["data-sl-theme"] });
    document.addEventListener("visibilitychange", sync);
    reduced.addEventListener("change", restyle);

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
