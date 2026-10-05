/**
 * macOS's title bar: the window keeps the system's traffic lights
 * (`hiddenInset`) inside spexr's own 44px bar, and keeps the system menu bar.
 * Kept free of Electron and Theia so the main process, the frontend and the
 * tests share one set of numbers.
 *
 * The geometry is the system's, measured on a macos-14 runner: each light is
 * a 14×16 button frame on a 20px pitch, holding a 12px circle 1px in from the
 * frame's left and 2px down from its top. Electron places the frames at
 * `trafficLightPosition` and grows the system's title bar container to
 * `frame height + 2 × y` (WindowButtonsProxy), so the position below centres
 * the circles on the bar and makes the container exactly the bar: the whole
 * bar is the system's title bar for double-click (zoom or minimize, as the
 * user set it in System Settings).
 */

/** spexr's title bar height (the kit's `.sl-titlebar`). */
export const TITLE_BAR_HEIGHT = 44;

/** The bar's left padding (the kit's `--sl-space-4`): where the first light starts. */
export const TITLE_BAR_PADDING = 16;

/** One traffic light's button frame, as AppKit lays it out. */
export const LIGHT_FRAME = { width: 14, height: 16 } as const;

/** The visible circle inside a frame, and where it sits in it. */
export const LIGHT_CIRCLE = { size: 12, insetX: 1, insetY: 2 } as const;

/** From one light's left edge to the next one's. */
export const LIGHT_PITCH = 20;

/** The three circles' width, first circle's left edge to last circle's right edge: 52px. */
export const TRAFFIC_LIGHTS_WIDTH = 2 * LIGHT_PITCH + LIGHT_CIRCLE.size;

/**
 * Electron's `trafficLightPosition`, the first frame's top-left corner: the
 * first circle starts on the bar's padding, and the circles' centre is the
 * bar's centre.
 */
export const TRAFFIC_LIGHT_POSITION = {
  x: TITLE_BAR_PADDING - LIGHT_CIRCLE.insetX,
  y: (TITLE_BAR_HEIGHT - LIGHT_FRAME.height) / 2,
} as const;

/** The BrowserWindow options spexr adds to a main window. */
export interface WindowChrome {
  readonly titleBarStyle?: "hiddenInset";
  readonly trafficLightPosition?: { readonly x: number; readonly y: number };
}

/**
 * A main window's title bar options: on macOS, the system's traffic lights
 * inside spexr's bar (`hiddenInset` at {@link TRAFFIC_LIGHT_POSITION});
 * elsewhere nothing, leaving S5b-1's frame decision alone. macOS gets them in
 * either frame Theia picks there: its forcing variable makes the window
 * frameless, which with a title bar style still shows the lights.
 */
export function macWindowChrome(platform: string): WindowChrome {
  if (platform !== "darwin") return {};
  return { titleBarStyle: "hiddenInset", trafficLightPosition: { ...TRAFFIC_LIGHT_POSITION } };
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
