import type { Page } from "@playwright/test";
import fs from "fs";
import path from "path";

export const SCENES = ["base", "palette", "toast", "focus-tree"] as const;
export type Scene = (typeof SCENES)[number];

export interface SceneResult {
  readonly scene: Scene;
  readonly file: string;
  /** Screenshots taken until two in a row were identical. */
  readonly attempts: number;
  /** False when the picture never settled; the last capture is kept anyway. */
  readonly stable: boolean;
  /** The last comparison: changed pixels outside the volatile regions, and where. */
  readonly lastDiff: PixelDiff | null;
  /** Infinite animations paused at t=0 before the capture. */
  readonly pausedLoops: number;
  /** What the fixture extension reported, when the scene goes through it. */
  readonly ack?: unknown;
}

/**
 * Run a command through the command palette, the way a user would.
 *
 * Focus is first handed back to the page body: a key pressed while focus sits
 * in an iframe (a webview) never reaches Theia's keybindings. F1 opens the
 * palette with the `>` prefix, and the other binding is tried if it does not.
 * The run waits until the focused row is the command before pressing Enter,
 * so a slow filter cannot run a different one.
 */
export async function runCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press("Escape");
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  const input = page.locator(".quick-input-widget input.input");
  let opened = false;
  for (const key of ["F1", process.platform === "darwin" ? "Meta+Shift+P" : "Control+Shift+P"]) {
    await page.keyboard.press(key);
    opened = await input
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (opened) break;
  }
  if (!opened) throw new Error(`the command palette did not open (focus: ${await describeFocus(page)})`);
  await input.fill(`>${label}`);
  await page
    .locator(".quick-input-list .monaco-list-row.focused", { hasText: label })
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.keyboard.press("Enter");
  await page.locator(".quick-input-widget").waitFor({ state: "hidden", timeout: 15_000 });
}

/** The focused element as `tag#id.class`, for error messages. */
export async function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "none";
    const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
    return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls}; document.hasFocus=${document.hasFocus()}`;
  });
}

/** Wait for the fixture extension's acknowledgement file, and return what it wrote. */
export async function waitForAck(ackDir: string, name: string, timeoutMs = 120_000): Promise<unknown> {
  const file = path.join(ackDir, `${name}.json`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, "utf8")) as { ok?: boolean; error?: string };
      fs.renameSync(file, `${file}.${Date.now()}.seen`);
      if (data.ok === false) throw new Error(`fixture extension: ${name} failed: ${data.error}`);
      return data;
    }
    if (Date.now() > deadline) throw new Error(`fixture extension: no "${name}" acknowledgement in ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/**
 * Park the pointer where nothing reacts to hover: the bottom-right corner of
 * the bottom panel, which is terminal ground. A pointer left on code would
 * raise Monaco's hover after a delay.
 */
export async function parkPointer(page: Page): Promise<void> {
  const box = await page.evaluate(() => {
    const el = document.getElementById("theia-bottom-content-panel");
    const r = el?.getBoundingClientRect();
    return r && r.width > 0 ? { x: r.right - 24, y: r.bottom - 12 } : { x: window.innerWidth - 4, y: window.innerHeight - 40 };
  });
  await page.mouse.move(box.x, box.y);
}

/**
 * Wait until no finite animation or transition is running. Infinite ones (a
 * live dot) are ignored: they never end, and the stability check below
 * decides whether they move pixels.
 */
async function waitForFiniteAnimations(page: Page, timeoutMs = 5_000): Promise<void> {
  await page
    .waitForFunction(
      () =>
        document.getAnimations().every((a) => {
          const end = a.effect?.getComputedTiming().endTime;
          return a.playState !== "running" || end === Infinity;
        }),
      undefined,
      { timeout: timeoutMs },
    )
    .catch(() => undefined);
}

/**
 * Regions that repaint on their own clock and are ignored when deciding that
 * the picture has settled (they still appear in the capture): the resource
 * meter polls every few seconds.
 */
const VOLATILE = ["#status-bar-spexr-resources"];

export interface PixelDiff {
  readonly changed: number;
  /** Bounding box of the changed pixels outside VOLATILE, as x,y,w,h; null when none. */
  readonly box: string | null;
}

/**
 * Compare two screenshots in the page itself (no image library in the
 * repository): decode both with createImageBitmap, count differing pixels
 * outside the volatile regions and report where they are.
 */
async function diffShots(page: Page, a: Buffer, b: Buffer): Promise<PixelDiff> {
  return page.evaluate(
    async ({ a64, b64, volatile }) => {
      const decode = async (b64s: string): Promise<ImageData> => {
        const bytes = Uint8Array.from(atob(b64s), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("no 2d context");
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [da, db] = await Promise.all([decode(a64), decode(b64)]);
      if (da.width !== db.width || da.height !== db.height) return { changed: -1, box: "size changed" };
      const masks = volatile.flatMap((sel) => [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect()));
      const masked = (x: number, y: number): boolean => masks.some((r) => x >= r.left && x < r.right && y >= r.top && y < r.bottom);
      let changed = 0;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -1;
      let y1 = -1;
      const w = da.width;
      for (let i = 0; i < da.data.length; i += 4) {
        if (da.data[i] === db.data[i] && da.data[i + 1] === db.data[i + 1] && da.data[i + 2] === db.data[i + 2]) continue;
        const x = (i / 4) % w;
        const y = Math.floor(i / 4 / w);
        if (masked(x, y)) continue;
        changed++;
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
      return { changed, box: changed ? `${x0},${y0},${x1 - x0 + 1},${y1 - y0 + 1}` : null };
    },
    { a64: a.toString("base64"), b64: b.toString("base64"), volatile: VOLATILE },
  );
}

/**
 * Pause every infinite animation at t=0, the treatment measure-demo.mjs gives
 * the demo: a looping sweep or breath is then the same frame in every capture
 * and in the reference. Run before each screenshot, because a scene can start
 * new loops. Canvas loops driven by requestAnimationFrame are not touched.
 */
async function pauseInfiniteAnimations(page: Page): Promise<number> {
  return page.evaluate(() => {
    let paused = 0;
    for (const a of document.getAnimations()) {
      if (a.effect?.getComputedTiming().endTime !== Infinity) continue;
      if (a.playState !== "paused" || a.currentTime !== 0) {
        a.pause();
        a.currentTime = 0;
        paused++;
      }
    }
    return paused;
  });
}

/**
 * Screenshot the window once two consecutive captures match outside the
 * volatile regions. Async work (semantic colours, decorations, a toast
 * sliding in) lands in its own time, and this waits for the pixels rather
 * than guessing a delay. Gives up after `maxAttempts`, keeping the last
 * capture and reporting where it kept changing.
 */
export async function captureStable(
  page: Page,
  file: string,
  maxAttempts = 12,
): Promise<{ attempts: number; stable: boolean; lastDiff: PixelDiff | null; pausedLoops: number }> {
  await waitForFiniteAnimations(page);
  let pausedLoops = await pauseInfiniteAnimations(page);
  let previous = await page.screenshot({ animations: "allow" });
  let lastDiff: PixelDiff | null = null;
  for (let attempt = 2; attempt <= maxAttempts; attempt++) {
    await page.waitForTimeout(400);
    pausedLoops += await pauseInfiniteAnimations(page);
    const next = await page.screenshot({ animations: "allow" });
    lastDiff = next.equals(previous) ? { changed: 0, box: null } : await diffShots(page, previous, next);
    if (lastDiff.changed === 0) {
      fs.writeFileSync(file, next);
      return { attempts: attempt, stable: true, lastDiff, pausedLoops };
    }
    previous = next;
  }
  fs.writeFileSync(file, previous);
  return { attempts: maxAttempts, stable: false, lastDiff, pausedLoops };
}

/** The first editor line whose number is fully in view, read from Monaco's gutter. */
export async function firstVisibleLine(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const editor = [...document.querySelectorAll<HTMLElement>(".monaco-editor")].find((e) => e.getBoundingClientRect().width > 0 && e.querySelector(".view-lines"));
    if (!editor) return null;
    const top = editor.getBoundingClientRect().top;
    const numbers = [...editor.querySelectorAll<HTMLElement>(".margin-view-overlays .line-numbers")]
      .map((el) => ({ n: Number(el.textContent?.trim()), y: el.getBoundingClientRect().top - top }))
      .filter((l) => Number.isFinite(l.n) && l.n > 0 && l.y >= 0)
      .sort((a, b) => a.y - b.y);
    return numbers[0]?.n ?? null;
  });
}

/** `Meta+P` on macOS, `Control+P` elsewhere: Theia's Quick Open. */
export const QUICK_OPEN = process.platform === "darwin" ? "Meta+P" : "Control+P";
