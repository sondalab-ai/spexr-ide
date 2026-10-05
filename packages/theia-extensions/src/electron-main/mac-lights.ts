import { FULL_SCREEN_EVENTS, lightsCss, lightsRoom, trafficLightPosition, zoomFactor, type LightsGeometry } from "../common/mac-title-bar.js";

/** The part of a BrowserWindow's webContents that {@link MacLights} uses. */
export interface LightsWebContents {
  getZoomLevel(): number;
  insertCSS(css: string): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
  on(event: "dom-ready", listener: () => void): unknown;
}

/** The part of a BrowserWindow that {@link MacLights} uses. */
export interface LightsWindow {
  readonly webContents: LightsWebContents;
  isDestroyed(): boolean;
  isFullScreen(): boolean;
  on(event: "enter-full-screen" | "leave-full-screen" | "closed", listener: () => void): unknown;
  setWindowButtonPosition(position: { x: number; y: number } | null): void;
}

/**
 * Forwards a window's full-screen transitions to its page, by the names in
 * FULL_SCREEN_EVENTS; `send` is Theia's window-event channel. Nothing is sent
 * to a window already destroyed.
 */
export function reportFullScreen(window: LightsWindow, send: (event: string) => void): void {
  const report = (event: string) => (): void => {
    if (!window.isDestroyed()) send(event);
  };
  window.on("enter-full-screen", report(FULL_SCREEN_EVENTS.enter));
  window.on("leave-full-screen", report(FULL_SCREEN_EVENTS.leave));
}

/**
 * The traffic lights of every macOS main window, kept on spexr's bar at any
 * zoom. The lights are in points and do not scale, while Theia's zoom scales
 * the page, bar included, so on every zoom change each window's lights move
 * to the bar's new centre and the page gets the room they take, and their
 * size, in its own pixels (lightsCss, injected as a stylesheet). Chromium zooms
 * every window of an origin together, so a change syncs them all. A page
 * that loads again gets its stylesheet again. In full screen the lights are
 * the system's (Electron itself skips redrawing them there, or they jump):
 * they move when the window leaves it.
 */
export class MacLights {
  private readonly windows = new Map<LightsWindow, LightsState>();

  constructor(private readonly geometry: LightsGeometry) {}

  /** Starts keeping `window`'s lights, and reports its full-screen transitions through `send`. */
  add(window: LightsWindow, send: (event: string) => void): void {
    const state: LightsState = { generation: 0, key: undefined, css: undefined, queue: Promise.resolve() };
    this.windows.set(window, state);
    window.on("closed", () => this.windows.delete(window));
    window.on("leave-full-screen", () => this.sync(window));
    window.webContents.on("dom-ready", () => {
      // A new document: the old one's sheet left with it, and any sheet still
      // in flight for it is dropped when it lands (restyle).
      state.generation++;
      state.key = undefined;
      state.css = undefined;
      this.sync(window);
    });
    reportFullScreen(window, send);
  }

  /**
   * Before Theia applies a zoom level, which spexr hears first: where the
   * room grows (zooming out), every page gets the new room now, so no frame
   * paints the new zoom with the old room and the mark under the lights. A
   * room that shrinks waits for {@link sync}, after the zoom: shrunk early,
   * it would put the mark on the lights at the old zoom.
   */
  prepareZoom(level: number): void {
    const next = zoomFactor(level);
    for (const [window, state] of this.windows) {
      if (window.isDestroyed()) continue;
      const now = zoomFactor(window.webContents.getZoomLevel());
      if (lightsRoom(this.geometry, next) > lightsRoom(this.geometry, now)) this.restyle(window, state, lightsCss(this.geometry, next));
    }
  }

  /** After a zoom change: every window follows. */
  syncAll(): void {
    for (const window of this.windows.keys()) this.sync(window);
  }

  /** Puts `window`'s lights on the bar's centre for its zoom, and gives its page their room. */
  sync(window: LightsWindow): void {
    const state = this.windows.get(window);
    if (!state || window.isDestroyed()) return;
    const factor = zoomFactor(window.webContents.getZoomLevel());
    if (!window.isFullScreen()) window.setWindowButtonPosition(trafficLightPosition(this.geometry, factor));
    this.restyle(window, state, lightsCss(this.geometry, factor));
  }

  /**
   * Gives the page `css`: inserted at once (so a call made before the zoom
   * lands before it), then, in call order, the old sheet removed once the
   * new one is in, so the room never drops to the fallback in between. A
   * sheet that lands after its document was replaced is dropped: it left
   * with that document, and its key must never reach the new one.
   */
  private restyle(window: LightsWindow, state: LightsState, css: string): void {
    if (window.isDestroyed() || state.css === css) return;
    state.css = css;
    const generation = state.generation;
    // A sheet that never went in must not stop the next try at the same css.
    const failed = (): void => {
      if (state.generation === generation && state.css === css) state.css = undefined;
    };
    let inserted: Promise<string>;
    try {
      inserted = window.webContents.insertCSS(css);
    } catch {
      failed();
      return;
    }
    inserted.catch(failed);
    state.queue = state.queue
      .then(async () => {
        const key = await inserted;
        if (generation !== state.generation || window.isDestroyed()) return;
        const previous = state.key;
        state.key = key;
        if (previous !== undefined) await window.webContents.removeInsertedCSS(previous);
      })
      .catch(() => undefined);
  }
}

/**
 * The main process's SetZoomLevel listener (spexr-electron-main-application):
 * the early room for the requested level, then the lights a turn later. It
 * runs before Theia's listener in the same emit, and an EventEmitter stops at
 * a listener that throws, so the early room is guarded: whatever it meets, the
 * zoom still reaches Theia's listener, and the sync is still scheduled.
 */
export function followZoom(
  lights: Pick<MacLights, "prepareZoom" | "syncAll">,
  later: (run: () => void) => unknown = (run) => setTimeout(run),
  report: (error: unknown) => void = (error) => console.error("spexr: the traffic lights' early room failed", error),
): (event: unknown, level: unknown) => void {
  return (_event, level) => {
    try {
      if (typeof level === "number") lights.prepareZoom(level);
    } catch (error) {
      report(error);
    }
    later(() => lights.syncAll());
  };
}

/** One window's injected stylesheet: its key, the css asked for last, and the document it belongs to. */
interface LightsState {
  generation: number;
  key: string | undefined;
  css: string | undefined;
  queue: Promise<void>;
}
