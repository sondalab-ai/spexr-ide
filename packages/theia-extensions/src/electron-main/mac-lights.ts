import { FULL_SCREEN_EVENTS, lightsCss, trafficLightPosition, zoomFactor, type LightsGeometry } from "../common/mac-title-bar.js";

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
  private readonly windows = new Map<LightsWindow, { key: string | undefined; queue: Promise<void> }>();

  constructor(private readonly geometry: LightsGeometry) {}

  /** Starts keeping `window`'s lights, and reports its full-screen transitions through `send`. */
  add(window: LightsWindow, send: (event: string) => void): void {
    this.windows.set(window, { key: undefined, queue: Promise.resolve() });
    window.on("closed", () => this.windows.delete(window));
    window.on("leave-full-screen", () => this.sync(window));
    window.webContents.on("dom-ready", () => {
      const state = this.windows.get(window);
      if (state) state.key = undefined;
      this.sync(window);
    });
    reportFullScreen(window, send);
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
    const css = lightsCss(this.geometry, factor);
    state.queue = state.queue.then(() => this.restyle(window, state, css)).catch(() => undefined);
  }

  /** The new stylesheet first, then the old one out, so the room never drops to the fallback in between. */
  private async restyle(window: LightsWindow, state: { key: string | undefined }, css: string): Promise<void> {
    if (window.isDestroyed()) return;
    const previous = state.key;
    state.key = await window.webContents.insertCSS(css);
    if (previous !== undefined && !window.isDestroyed()) await window.webContents.removeInsertedCSS(previous);
  }
}
