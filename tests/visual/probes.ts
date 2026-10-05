import type { ElectronApplication, Page } from "@playwright/test";
import fs from "fs";
import path from "path";
import { checkLights, findLights, type LightsCheck, type Rect } from "./lights";
import { nativeCapture } from "./native";

/** What the environment gave this capture: read by the step summary, never asserted on. */
export interface PageProbes {
  readonly webgl2: boolean;
  /** `webgl` / `canvas` / `dom`, read from the bottom terminal's xterm. */
  readonly xtermRenderer: string;
  readonly xtermDetail: string;
  readonly devicePixelRatio: number;
  readonly innerSize: string;
  readonly hasFocus: boolean;
  /** Monaco's line font, as computed on the rendered lines. */
  readonly editorFont: string;
  /** Advance of one character in the editor, measured on a rendered line. */
  readonly monacoCharWidth: number | null;
  /** The top panel, spexr's title bar: shown in either frame since S5b-1. */
  readonly topPanelVisible: boolean;
  /** Theia's in-page window controls: present only with a custom (frameless) window. */
  readonly windowControls: boolean;
  /** The bar's room for macOS's traffic lights (S5b-2): on macOS outside full screen only. */
  readonly trafficLights: boolean;
  /**
   * Where each part tagged `data-parity` is, in CSS px, keyed like the regions
   * of reference/demo-regions.json (`title.cmd`, …), plus Theia's window
   * controls as `title.controls`; one rect per element, in DOM order.
   */
  readonly parity: Record<string, Array<{ x: number; y: number; w: number; h: number }>>;
}

export interface MainProbes {
  readonly electron: string;
  readonly chromium: string;
  readonly node: string;
  readonly platform: string;
  readonly contentSize: string;
  readonly mediaSourceId: string;
  /** The window's outer bounds, `x,y wxh`: on macOS with the title bar hidden, the same size as the content. */
  readonly bounds: string;
  /** macOS: the traffic lights' position the window was created with (`trafficLightPosition`); null elsewhere. */
  readonly windowButtonPosition: { x: number; y: number } | null;
  /** `process.getSystemVersion()`: the macOS version on macOS ("26.6.2"). */
  readonly systemVersion: string;
}

/** The bar one zoom level out (83%), through Theia's own zoom route. */
export interface ZoomProbe {
  readonly level: number;
  readonly factor: number;
  /** The room the main process set for the page, before and after (LIGHTS_ROOM_PROPERTY). */
  readonly roomBefore: string;
  readonly roomAfter: string | null;
  /** The lights' position the main process moved them to. */
  readonly windowButtonPosition: { x: number; y: number } | null;
  /** The mark's left edge in points, and its distance from the last light's right edge. */
  readonly markLeftPt: number | null;
  readonly markGapPt: number | null;
  readonly lights?: LightsCheck;
  readonly ok: boolean;
  readonly problems: string[];
}

/** One full-screen transition, driven from the main process as the green button would. */
export interface FullScreenStep {
  /** Whether the window emitted the transition's event before the timeout. */
  readonly event: boolean;
  /** From that event until the bar's room for the lights had gone (entering) or come back (leaving); null if it never did. */
  readonly answeredMs: number | null;
  /** Whether the bar has the lights' room once the step is over. */
  readonly trafficLights: boolean;
  /** The mark's x once the step is over. */
  readonly markX: number | null;
}

export interface FullScreenProbe {
  enter?: FullScreenStep;
  leave?: FullScreenStep;
  error?: string;
}

export interface LogProbes {
  /** From the plugin deployer: "Deploy batch of N accepted plugins". */
  readonly deployedPlugins: number | null;
  /**
   * "The local plugin referenced by … does not exist." lines, except Theia's
   * own per-user plugin folders under the config dir, which a fresh profile
   * never has; those are counted in `userPluginDirsMissing`.
   */
  readonly missingPluginPaths: string[];
  readonly userPluginDirsMissing: number;
}

export async function probePage(page: Page): Promise<PageProbes> {
  return page.evaluate(() => {
    let webgl2 = false;
    try {
      webgl2 = !!document.createElement("canvas").getContext("webgl2");
    } catch {
      webgl2 = false;
    }
    const term = document.querySelector<HTMLElement>("#theia-bottom-content-panel .xterm") ?? document.querySelector<HTMLElement>(".xterm");
    let xtermRenderer = "none";
    let xtermDetail = "no terminal";
    if (term) {
      const canvases = [...term.querySelectorAll("canvas")];
      const rows = term.querySelector(".xterm-rows");
      const classes = canvases.map((c) => c.className || "(no class)");
      const gl = canvases.some((c) => {
        try {
          return !!(c.getContext("webgl2") || c.getContext("webgl"));
        } catch {
          return false;
        }
      });
      xtermRenderer = rows && rows.childElementCount > 0 ? "dom" : canvases.length === 0 ? "none" : gl ? "webgl" : "canvas";
      xtermDetail = `${canvases.length} canvas [${classes.join(", ")}], dom rows ${rows ? rows.childElementCount : 0}`;
    }

    // A visible line with enough text to average over; hidden editors stay in the DOM.
    const line = [...document.querySelectorAll<HTMLElement>(".monaco-editor .view-lines .view-line")].find(
      (el) => (el.textContent ?? "").trim().length > 20 && el.getBoundingClientRect().width > 0,
    );
    let monacoCharWidth: number | null = null;
    let editorFont = "no editor";
    if (line) {
      const cs = getComputedStyle(line);
      editorFont = `${cs.fontSize}/${cs.lineHeight} ${cs.fontFamily}`;
      const range = document.createRange();
      range.selectNodeContents(line);
      const text = line.textContent ?? "";
      monacoCharWidth = text.length ? Math.round((range.getBoundingClientRect().width / text.length) * 1000) / 1000 : null;
    }
    const top = document.getElementById("theia-top-panel");
    const parity: Record<string, Array<{ x: number; y: number; w: number; h: number }>> = {};
    const round = (n: number): number => Math.round(n * 100) / 100;
    // Monaco's list rows carry data-parity too, as even/odd.
    const tagged: Array<[string, Element]> = [...document.querySelectorAll<HTMLElement>("[data-parity]")]
      .map((el): [string, Element] => [el.dataset.parity ?? "?", el])
      .filter(([key]) => key !== "even" && key !== "odd");
    const controls = document.getElementById("window-controls");
    if (controls) tagged.push(["title.controls", controls]);
    for (const [key, el] of tagged) {
      const r = el.getBoundingClientRect();
      (parity[key] ??= []).push({ x: round(r.x), y: round(r.y), w: round(r.width), h: round(r.height) });
    }
    return {
      webgl2,
      xtermRenderer,
      xtermDetail,
      devicePixelRatio: window.devicePixelRatio,
      innerSize: `${window.innerWidth}x${window.innerHeight}`,
      hasFocus: document.hasFocus(),
      editorFont,
      monacoCharWidth,
      topPanelVisible: !!top && !top.classList.contains("lm-mod-hidden") && top.getBoundingClientRect().height > 0,
      windowControls: !!document.getElementById("window-controls"),
      trafficLights: !!document.querySelector('[data-parity="title.dots"]'),
      parity,
    };
  });
}

export async function probeMain(app: ElectronApplication): Promise<MainProbes> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    const [w, h] = win ? win.getContentSize() : [0, 0];
    const b = win?.getBounds();
    return {
      electron: process.versions.electron ?? "",
      chromium: process.versions.chrome ?? "",
      node: process.versions.node ?? "",
      platform: `${process.platform}-${process.arch}`,
      contentSize: `${w}x${h}`,
      mediaSourceId: win ? win.getMediaSourceId() : "",
      bounds: b ? `${b.x},${b.y} ${b.width}x${b.height}` : "",
      windowButtonPosition: win && process.platform === "darwin" ? (win.getWindowButtonPosition() ?? null) : null,
      systemVersion: process.getSystemVersion(),
    };
  });
}

/** The first `data-parity` rect of `key` on the page, in CSS px. */
async function parityRect(page: Page, key: string): Promise<Rect | undefined> {
  return page.evaluate((key) => {
    const r = document.querySelector(`[data-parity="${key}"]`)?.getBoundingClientRect();
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : undefined;
  }, key);
}

/** The room the main process has set on the page, as the computed custom property. */
async function roomProperty(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--spexr-traffic-lights").trim());
}

/**
 * macOS's traffic lights in the native capture at 100%, checked against the
 * bar: inside its room (`title.dots`) and centred on it (lights.ts).
 */
export async function probeLights(file: string, page: Page, windowWidth: number): Promise<LightsCheck> {
  const found = await findLights(file, windowWidth);
  return checkLights(file, found, 1, await parityRect(page, "title"), await parityRect(page, "title.dots"));
}

/**
 * macOS only: one zoom level out through Theia's zoom route (the page's
 * setZoomLevel, which the main process applies), a native capture, and the
 * lights checked against the bar there: centred on it, and the mark a gap
 * clear of them. Zoom goes back to 100% after.
 */
export async function probeZoom(app: ElectronApplication, page: Page, base: string, level = -1): Promise<ZoomProbe> {
  const factor = Math.pow(1.2, level);
  const problems: string[] = [];
  const roomBefore = await roomProperty(page);
  const setZoom = (to: number): Promise<void> =>
    page.evaluate((to) => (window as unknown as { electronTheiaCore: { setZoomLevel(level: number): void } }).electronTheiaCore.setZoomLevel(to), to);
  let roomAfter: string | null = null;
  let lights: LightsCheck | undefined;
  let windowButtonPosition: { x: number; y: number } | null = null;
  let markLeftPt: number | null = null;
  let markGapPt: number | null = null;
  try {
    await setZoom(level);
    roomAfter = await page
      .waitForFunction(
        (before) => {
          const now = getComputedStyle(document.documentElement).getPropertyValue("--spexr-traffic-lights").trim();
          return now && now !== before ? now : false;
        },
        roomBefore,
        { timeout: 10_000 },
      )
      .then((handle) => handle.jsonValue() as Promise<string>)
      .catch(() => null);
    if (roomAfter === null) problems.push(`the room stayed ${roomBefore || "unset"}`);
    windowButtonPosition = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getWindowButtonPosition() ?? null);
    const width = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.getBounds().width ?? 0);
    const shots = await nativeCapture(app, base);
    const shot = shots.find((s) => s.ok);
    if (!shot) problems.push("no native capture");
    else {
      const file = path.join(path.dirname(base), shot.file);
      const found = await findLights(file, width);
      lights = checkLights(file, found, factor, await parityRect(page, "title"));
      problems.push(...lights.problems);
      const mark = await parityRect(page, "title.mark");
      const lastRight = Math.max(...found.circles.map((c) => c.right));
      if (mark && found.circles.length) {
        markLeftPt = mark.x * factor;
        markGapPt = markLeftPt - lastRight;
        if (markGapPt < 12 * factor - 1) problems.push(`the mark is ${markGapPt}pt from the lights, under the gap of ${12 * factor}pt`);
      }
    }
  } finally {
    await setZoom(0);
    await page
      .waitForFunction((before) => getComputedStyle(document.documentElement).getPropertyValue("--spexr-traffic-lights").trim() === before, roomBefore, {
        timeout: 10_000,
      })
      .catch(() => problems.push("the room did not come back at 100%"));
  }
  return { level, factor, roomBefore, roomAfter, windowButtonPosition, markLeftPt, markGapPt, lights, ok: problems.length === 0, problems };
}

/**
 * macOS only, the run's last step: full screen on and off from the main
 * process, which takes the same route as the green button and the system
 * menu, so the bar has to follow Electron's events, not Theia's command.
 * Best-effort: a runner that cannot enter full screen records why and the
 * capture goes on. `shot` takes the page's bar while in full screen.
 */
export async function probeFullScreen(app: ElectronApplication, page: Page, shot?: string): Promise<FullScreenProbe> {
  const probe: FullScreenProbe = {};
  try {
    probe.enter = await fullScreenStep(app, page, true);
    if (shot) await page.screenshot({ path: shot });
    probe.leave = await fullScreenStep(app, page, false);
  } catch (err) {
    probe.error = String(err instanceof Error ? err.message : err);
  }
  return probe;
}

async function fullScreenStep(app: ElectronApplication, page: Page, on: boolean): Promise<FullScreenStep> {
  const event = await app.evaluate(
    ({ BrowserWindow }, on) =>
      new Promise<boolean>((resolve) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (!win) return resolve(false);
        const timer = setTimeout(() => resolve(false), 20_000);
        const done = (): void => {
          clearTimeout(timer);
          resolve(true);
        };
        if (on) win.once("enter-full-screen", done);
        else win.once("leave-full-screen", done);
        win.setFullScreen(on);
      }),
    on,
  );
  const since = Date.now();
  const answered = await page
    .waitForFunction((on) => !document.querySelector('[data-parity="title.dots"]') === on, on, { timeout: 10_000 })
    .then(
      () => true,
      () => false,
    );
  const answeredMs = answered ? Date.now() - since : null;
  const after = await page.evaluate(() => ({
    trafficLights: !!document.querySelector('[data-parity="title.dots"]'),
    markX: document.querySelector('[data-parity="title.mark"]')?.getBoundingClientRect().x ?? null,
  }));
  return { event, answeredMs, ...after };
}

export function probeLog(logFile: string, configDir: string): LogProbes {
  const text = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  const batches = [...text.matchAll(/Deploy batch of (\d+) accepted plugins/g)].map((m) => Number(m[1]));
  const missing = [...new Set([...text.matchAll(/The local plugin referenced by (\S+) does not exist/g)].map((m) => m[1] ?? ""))];
  const userDirs = new Set(["plugins", "deployedPlugins"].map((d) => `local-dir:${path.join(configDir, d)}`));
  return {
    deployedPlugins: batches.length ? batches.reduce((a, b) => a + b, 0) : null,
    missingPluginPaths: missing.filter((m) => !userDirs.has(m)),
    userPluginDirsMissing: missing.filter((m) => userDirs.has(m)).length,
  };
}
