/**
 * macOS's title bar: the window keeps the system's traffic lights
 * (`hiddenInset`) inside spexr's own 44px bar, and keeps the system menu bar.
 * Kept free of Electron and Theia so the main process, the frontend and the
 * tests share one set of numbers.
 *
 * Electron places the lights' button frames at `trafficLightPosition` (or
 * `setWindowButtonPosition`) and sizes the system's title bar container from
 * the live frame: `frame height + 2 × y` (WindowButtonsProxy::redraw). A
 * position that centres the circles on the bar therefore also makes the
 * container the bar, and the whole bar is the system's title bar for
 * double-click (zoom or minimize, as the user set it in System Settings).
 * The frame changed with macOS 26 (see {@link lightsGeometry}), and the bar's
 * height in points changes with Theia's zoom, so the position is computed,
 * not fixed.
 */

/** spexr's title bar height in CSS px (the kit's `.sl-titlebar`). */
export const TITLE_BAR_HEIGHT = 44;

/** The bar's left padding in CSS px (the kit's `--sl-space-4`): where the first light starts. */
export const TITLE_BAR_PADDING = 16;

/** The traffic lights as AppKit lays them out, in points. */
export interface LightsGeometry {
  /** One light's button frame. */
  readonly frame: { readonly width: number; readonly height: number };
  /** The visible circle inside a frame, and its offset from the frame's top-left corner. */
  readonly circle: { readonly size: number; readonly insetX: number; readonly insetY: number };
  /** From one light's left edge to the next one's. */
  readonly pitch: number;
}

/**
 * macOS 15 and earlier, measured on the macos-14 runner (S5b-1's native
 * capture of a standard window): 14×16 frames on a 20pt pitch, a 12pt circle
 * 1pt in and 2pt down.
 */
export const LIGHTS_BEFORE_TAHOE: LightsGeometry = {
  frame: { width: 14, height: 16 },
  circle: { size: 12, insetX: 1, insetY: 2 },
  pitch: 20,
};

/**
 * macOS 26 (Darwin 25) and later, measured on the macos-26 runner (26.6.2,
 * S5b-2's native capture at a known position): 14pt circles that fill their
 * 14×14 frames, on a 23pt pitch, so the three take 60pt, not 52. The 14pt
 * frame height is VS Code's getMacOSWindowControlsPosition's too.
 */
export const LIGHTS_TAHOE: LightsGeometry = {
  frame: { width: 14, height: 14 },
  circle: { size: 14, insetX: 0, insetY: 0 },
  pitch: 23,
};

/** The Darwin major version from `os.release()` ("25.6.0" → 25); 0 when unreadable. */
export function darwinMajor(release: string): number {
  const major = Number.parseInt(release, 10);
  return Number.isFinite(major) ? major : 0;
}

/** The lights' geometry for a Darwin major version: macOS 26 is Darwin 25. */
export function lightsGeometry(darwin: number): LightsGeometry {
  return darwin >= 25 ? LIGHTS_TAHOE : LIGHTS_BEFORE_TAHOE;
}

/** The three circles' width, first circle's left edge to last circle's right edge. */
export function lightsWidth(geometry: LightsGeometry): number {
  return 2 * geometry.pitch + geometry.circle.size;
}

/** The last circle's right edge, in points from the window's left edge. */
export function lightsRight(geometry: LightsGeometry): number {
  return TITLE_BAR_PADDING + lightsWidth(geometry);
}

/** Chromium's zoom factor for a zoom level: 1.2 to the level (Theia steps it by 0.5). */
export function zoomFactor(level: number): number {
  return Math.pow(1.2, level);
}

/**
 * The first frame's top-left corner, in whole points (Electron takes a
 * point): the first circle starts on the bar's padding at 100%, and the
 * circles' centre is the bar's centre at the bar's height in points (44 ×
 * the zoom factor). The horizontal place stays put: the lights do not scale.
 */
export function trafficLightPosition(geometry: LightsGeometry, factor = 1): { x: number; y: number } {
  const barPt = TITLE_BAR_HEIGHT * factor;
  return {
    x: TITLE_BAR_PADDING - geometry.circle.insetX,
    y: Math.round(barPt / 2 - geometry.circle.insetY - geometry.circle.size / 2),
  };
}

/**
 * The room the bar keeps for the lights, in CSS px at a zoom factor: from the
 * bar's padding to the lights' right edge, which stays put in points while
 * the page scales. The bar's own gap follows it, so the mark is always a gap
 * clear of the lights. Never negative.
 */
export function lightsRoom(geometry: LightsGeometry, factor = 1): number {
  return Math.max(0, lightsRight(geometry) / factor - TITLE_BAR_PADDING);
}

/**
 * The custom properties the main process sets on a macOS window's page: the
 * room ({@link lightsRoom}) and one light's height, both in CSS px at the
 * page's zoom. spexr.css falls back to the macOS 15 values at 100% before
 * they arrive.
 */
export const LIGHTS_ROOM_PROPERTY = "--spexr-traffic-lights";
export const LIGHT_SIZE_PROPERTY = "--spexr-traffic-light-size";

/** The stylesheet the main process injects for a geometry at a zoom factor, rounded to 1/100 px. */
export function lightsCss(geometry: LightsGeometry, factor = 1): string {
  const px = (n: number): string => `${Math.round(n * 100) / 100}px`;
  return `:root { ${LIGHTS_ROOM_PROPERTY}: ${px(lightsRoom(geometry, factor))}; ${LIGHT_SIZE_PROPERTY}: ${px(geometry.circle.size / factor)}; }`;
}

/** The BrowserWindow options spexr adds to a main window. */
export interface WindowChrome {
  readonly titleBarStyle?: "hiddenInset";
  readonly trafficLightPosition?: { readonly x: number; readonly y: number };
}

/**
 * A main window's title bar options: on macOS, the system's traffic lights
 * inside spexr's bar (`hiddenInset`, placed for this macOS at 100%);
 * elsewhere nothing, leaving S5b-1's frame decision alone. macOS gets them in
 * either frame Theia picks there: its forcing variable makes the window
 * frameless, which with a title bar style still shows the lights.
 */
export function macWindowChrome(platform: string, release: string): WindowChrome {
  if (platform !== "darwin") return {};
  return { titleBarStyle: "hiddenInset", trafficLightPosition: trafficLightPosition(lightsGeometry(darwinMajor(release))) };
}

/**
 * Whether the bar keeps room for the traffic lights: on macOS, except in full
 * screen, where macOS hides them with the system's title bar.
 */
export function trafficLightInset(mac: boolean, fullScreen: boolean): boolean {
  return mac && !fullScreen;
}

/**
 * The window events the main process adds to Theia's window-event channel
 * (`electronTheiaCore.onWindowEvent`), which carries only maximize, unmaximize
 * and focus: Electron's `enter-full-screen` and `leave-full-screen`, sent
 * once a transition has finished, on every path into or out of full screen
 * (the green button, the system menu's ⌃⌘F, Theia's command). Prefixed so a
 * name Theia adds later cannot collide.
 */
export const FULL_SCREEN_EVENTS = {
  enter: "spexr-enter-full-screen",
  leave: "spexr-leave-full-screen",
} as const;

/** The part of `window.electronTheiaCore` that {@link followFullScreen} uses. */
export interface FullScreenSource {
  onWindowEvent(event: string, handler: () => void): unknown;
  isFullScreen(): boolean;
}

/**
 * The frontend's side of full screen, on macOS only: subscribe to both
 * transitions, then read the state once. The read is defensive: Theia never
 * reopens a window in full screen, but a reload, or a transition that ends
 * while the page starts, would otherwise go unseen.
 */
export function followFullScreen(mac: boolean, source: FullScreenSource, show: (lights: boolean) => void): void {
  if (!mac) return;
  source.onWindowEvent(FULL_SCREEN_EVENTS.enter, () => show(trafficLightInset(mac, true)));
  source.onWindowEvent(FULL_SCREEN_EVENTS.leave, () => show(trafficLightInset(mac, false)));
  show(trafficLightInset(mac, source.isFullScreen()));
}
