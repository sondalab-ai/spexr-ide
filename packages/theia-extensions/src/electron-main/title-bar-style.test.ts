import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  applyTitleBarStyle,
  decideTitleBarStyle,
  TITLE_BAR_MIGRATION_KEY,
  type TitleBarEnvironment,
  type TitleBarInputs,
  type TitleBarStore,
} from "./title-bar-style.js";

const base: TitleBarInputs = { platform: "linux", forceCustom: false, storedFrame: undefined, migrated: false, configured: undefined };
const decide = (over: Partial<TitleBarInputs>) => decideTitleBarStyle({ ...base, ...over });

describe("decideTitleBarStyle", () => {
  it("gives a fresh install the custom frame on Linux and Windows, and marks the migration done", () => {
    expect(decide({ platform: "linux" })).toEqual({ style: "custom", dropStoredFrame: false, markMigrated: true });
    expect(decide({ platform: "win32" })).toEqual({ style: "custom", dropStoredFrame: false, markMigrated: true });
  });

  it("ignores, once, the native frame Theia's old Linux default stored, and drops it from the store", () => {
    expect(decide({ platform: "linux", storedFrame: true })).toEqual({ style: "custom", dropStoredFrame: true, markMigrated: true });
  });

  it("keeps a native frame stored after the migration: the user's window.titleBarStyle, the escape hatch", () => {
    expect(decide({ platform: "linux", storedFrame: true, migrated: true })).toEqual({ style: "native", dropStoredFrame: false, markMigrated: false });
  });

  it("keeps a stored custom frame, and writes nothing once migrated", () => {
    expect(decide({ platform: "linux", storedFrame: false, migrated: true })).toEqual({ style: "custom", dropStoredFrame: false, markMigrated: false });
    expect(decide({ platform: "linux", storedFrame: false })).toEqual({ style: "custom", dropStoredFrame: false, markMigrated: true });
  });

  // Windows already defaulted to custom, so a stored native frame there was chosen.
  it("keeps a native frame stored on Windows, even on the first run", () => {
    expect(decide({ platform: "win32", storedFrame: true })).toEqual({ style: "native", dropStoredFrame: false, markMigrated: true });
  });

  // "native" is Theia's frame semantics: the system menu bar, native context
  // menus, no window controls in the page. macOS's window still hides the
  // system's title bar, through its window options (macWindowChrome).
  it("keeps macOS native, whatever is stored or configured", () => {
    expect(decide({ platform: "darwin" }).style).toBe("native");
    expect(decide({ platform: "darwin", storedFrame: false, configured: "custom" }).style).toBe("native");
    expect(decide({ platform: "darwin", storedFrame: true }).dropStoredFrame).toBe(false);
  });

  it("puts Theia's forcing variable before everything, macOS included", () => {
    expect(decide({ forceCustom: true, storedFrame: true, migrated: true }).style).toBe("custom");
    expect(decide({ forceCustom: true, platform: "darwin" }).style).toBe("custom");
  });

  it("reads the application config after the stored frame, and only its two values", () => {
    expect(decide({ configured: "native" }).style).toBe("native");
    expect(decide({ configured: "native", storedFrame: false, migrated: true }).style).toBe("custom");
    expect(decide({ configured: "bogus" }).style).toBe("custom");
  });

  it("keys the flag flat: electron-store reads a dotted key as a nested path", () => {
    expect(TITLE_BAR_MIGRATION_KEY).not.toContain(".");
  });
});

/** An in-memory electron-store that counts its writes and can be told to fail one key. */
function fakeStore(initial: Record<string, unknown>, failing?: string): TitleBarStore & { data: Record<string, unknown>; writes: string[] } {
  const data: Record<string, unknown> = structuredClone(initial);
  const writes: string[] = [];
  return {
    data,
    writes,
    get: (key) => data[key],
    set: (key, value) => {
      if (key === failing) throw new Error(`ENOSPC writing ${key}`);
      writes.push(key);
      data[key] = value;
    },
  };
}

const linux: TitleBarEnvironment = { platform: "linux", forceCustom: false, configured: undefined };
const quiet = (): void => undefined;

describe("applyTitleBarStyle", () => {
  const upgraded = { windowstate: { frame: true, width: 1280, height: 800 } };

  it("drops a stored native frame once, keeps the rest of the window state, and sets the flag once", () => {
    const store = fakeStore(upgraded);
    expect(applyTitleBarStyle(store, linux, quiet)).toBe("custom");
    expect(store.data["windowstate"]).toEqual({ width: 1280, height: 800 });
    expect(store.data[TITLE_BAR_MIGRATION_KEY]).toBe(true);
    expect(store.writes).toEqual(["windowstate", TITLE_BAR_MIGRATION_KEY]);
    expect(applyTitleBarStyle(store, linux, quiet)).toBe("custom");
    expect(store.writes).toHaveLength(2);
  });

  it("sets only the flag when no window state is stored", () => {
    const store = fakeStore({});
    expect(applyTitleBarStyle(store, linux, quiet)).toBe("custom");
    expect(store.writes).toEqual([TITLE_BAR_MIGRATION_KEY]);
    expect("windowstate" in store.data).toBe(false);
  });

  it("keeps the escape hatch after the migration: a native frame stored later wins and nothing is written", () => {
    const store = fakeStore({ ...upgraded, [TITLE_BAR_MIGRATION_KEY]: true });
    expect(applyTitleBarStyle(store, linux, quiet)).toBe("native");
    expect(store.writes).toEqual([]);
  });

  it("never throws when the frame cannot be dropped: it follows the frame the window will open with, and tries again next time", () => {
    const store = fakeStore(upgraded, "windowstate");
    const reports: string[] = [];
    expect(applyTitleBarStyle(store, linux, (message) => reports.push(message))).toBe("native");
    expect(store.data[TITLE_BAR_MIGRATION_KEY]).toBeUndefined();
    expect(reports).toHaveLength(1);
  });

  it("never throws when the flag cannot be written, and this run is still right", () => {
    const store = fakeStore(upgraded, TITLE_BAR_MIGRATION_KEY);
    const reports: string[] = [];
    expect(applyTitleBarStyle(store, linux, (message) => reports.push(message))).toBe("custom");
    expect(store.data["windowstate"]).toEqual({ width: 1280, height: 800 });
    expect(reports).toHaveLength(1);
  });

  it("writes only the flag on macOS and Windows", () => {
    const mac = fakeStore(upgraded);
    expect(applyTitleBarStyle(mac, { ...linux, platform: "darwin" }, quiet)).toBe("native");
    expect(mac.writes).toEqual([TITLE_BAR_MIGRATION_KEY]);
    const win = fakeStore(upgraded);
    expect(applyTitleBarStyle(win, { ...linux, platform: "win32" }, quiet)).toBe("native");
    expect(win.writes).toEqual([TITLE_BAR_MIGRATION_KEY]);
  });
});

const theiaMain = readFileSync(createRequire(import.meta.url).resolve("@theia/core/lib/electron-main/electron-main-application.js"), "utf8");
const ours = readFileSync(fileURLToPath(new URL("./spexr-electron-main-application.ts", import.meta.url)), "utf8");

/** The body of a method of Theia's ElectronMainApplication, from its compiled source. */
function method(signature: string): string {
  const start = theiaMain.indexOf(`\n    ${signature} {`);
  expect(start, `ElectronMainApplication.${signature}`).toBeGreaterThanOrEqual(0);
  return theiaMain.slice(start, theiaMain.indexOf("\n    }\n", start));
}

// decideTitleBarStyle restates Theia's getTitleBarStyle order; if an upgrade
// changes what Theia reads there, or how the stored state reaches a window,
// these fail before a window opens in the wrong frame.
describe("Theia's title bar style, which the main application overrides", () => {
  it("reads the forcing variable, macOS, the stored frame and the config, in that order", () => {
    const body = method("getTitleBarStyle(config)");
    const order = ["THEIA_ELECTRON_DISABLE_NATIVE_ELEMENTS", "isOSX", "this.electronStore.get('windowstate')?.frame", "config.preferences['window.titleBarStyle']"];
    const at = order.map((needle) => body.indexOf(needle));
    for (const [i, pos] of at.entries()) expect(pos, order[i]).toBeGreaterThanOrEqual(0);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("is called once at start, and spreads the stored window state over the frame it computed", () => {
    expect(theiaMain).toContain("this.useNativeWindowFrame = this.getTitleBarStyle(config) === 'native';");
    const options = method("async getLastWindowOptions()");
    expect(options).toMatch(/frame: this\.useNativeWindowFrame,[\s\S]*\.\.\.windowState/);
  });

  it("saves the frame Theia's setTitleBarStyle chose, the escape hatch's route", () => {
    expect(method("setTitleBarStyle(webContents, style)")).toContain("this.saveState(webContents)");
    expect(method("saveWindowState(electronWindow)")).toContain("frame: this.useNativeWindowFrame");
  });

  it("is overridden through applyTitleBarStyle on Theia's own store", () => {
    expect(ours).toMatch(/protected override getTitleBarStyle\(config: ElectronMainApplication\["config"\]\): TitleBarStyle/);
    expect(ours).toContain("return applyTitleBarStyle(this.electronStore as unknown as TitleBarStore, {");
  });
});

const theiaApiMain = readFileSync(createRequire(import.meta.url).resolve("@theia/core/lib/electron-main/electron-api-main.js"), "utf8");

/** The body of `startMarker`'s block in Theia's main application, up to `endMarker`. */
function between(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, startMarker).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endMarker, start);
  expect(end, `${endMarker} after ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

// macOS's inset title bar is a default window option (macWindowChrome in
// getDefaultOptions). These fail if an upgrade stops the main window from
// starting with the defaults, lets the stored state override them, or starts
// giving secondary windows the defaults too.
describe("Theia's window options, which carry macOS's title bar", () => {
  it("start every main window from getDefaultOptions, new or restored", () => {
    expect(method("getDefaultTheiaWindowOptions()")).toContain("...this.getDefaultOptions(),");
    expect(method("async getLastWindowOptions()")).toMatch(/\.\.\.this\.getDefaultOptions\(\),\s*\.\.\.windowState/);
  });

  it("store bounds and the frame, never a title bar style, so the restored state cannot undo it", () => {
    const saved = method("saveWindowState(electronWindow)");
    expect(saved).toContain("frame: this.useNativeWindowFrame,");
    expect(saved).not.toMatch(/titleBarStyle|trafficLightPosition|\.\.\./);
  });

  // A secondary window holds one view and no title bar of its own: with a
  // hidden system title bar it could not be dragged.
  it("build a secondary window without the defaults, in the system's frame", () => {
    const secondary = between(theiaMain, "webContents.setWindowOpenHandler(details => {", "return {");
    expect(secondary).toContain("frame: true,");
    expect(secondary).toContain("minWidth: defaultOptions.minWidth,");
    expect(secondary).not.toMatch(/\.\.\.(this\.getDefaultOptions\(\)|defaultOptions)\b/);
  });

  it("open every main window through createWindow, where spexr reports full screen", () => {
    expect(method("showInitialWindow(urlToOpen)")).toContain("this.initialWindow = await this.createWindow({ ...options });");
    expect(method("async reuseOrCreateWindow(asyncOptions)")).toContain("return this.createWindow(asyncOptions);");
  });

  it("send a window event to the page as its bare name, on Theia's window-event channel", () => {
    expect(theiaApiMain).toMatch(/function sendWindowEvent\(wc, event\) \{\s*wc\.send\(electron_api_1\.CHANNEL_ON_WINDOW_EVENT, event\);\s*\}/);
  });
});

describe("spexr's main application on macOS", () => {
  it("adds macWindowChrome to Theia's defaults, before the webview tag's web preferences", () => {
    expect(ours).toContain("return { ...options, ...macWindowChrome(process.platform, release()), webPreferences: { ...options.webPreferences, webviewTag: true } };");
    expect(ours).toContain('import { release } from "node:os";');
  });

  it("keeps every macOS main window's lights, for the running macOS, and reports its full screen", () => {
    expect(ours).toContain("private readonly macLights = new MacLights(lightsGeometry(darwinMajor(release())));");
    const create = between(ours, "override async createWindow(", "\n  }\n");
    expect(create).toContain("const window = await super.createWindow(asyncOptions);");
    expect(create).toMatch(/if \(process\.platform === "darwin"\) \{\s*this\.macLights\.add\(window, \(event\) => TheiaRendererAPI\.sendWindowEvent\(window\.webContents, event as WindowEvent\)\);/);
  });

  it("hears every zoom change Theia makes first: a growing room at once, the lights a turn after Theia applies it", () => {
    const hook = between(ours, "protected override hookApplicationEvents(): void {", "\n  }\n");
    expect(hook).toContain("super.hookApplicationEvents();");
    expect(hook).toContain('if (process.platform === "darwin") ipcMain.on(CHANNEL_SET_ZOOM_LEVEL, followZoom(this.macLights));');
  });
});

// The lights follow the zoom through Theia's own route for it; these fail if
// a zoom change could reach the page another way, or if the order that makes
// the setTimeout necessary changes.
describe("Theia's zoom, which the lights follow", () => {
  const theiaPreload = readFileSync(createRequire(import.meta.url).resolve("@theia/core/lib/electron-browser/preload.js"), "utf8");
  const theiaWindowService = readFileSync(createRequire(import.meta.url).resolve("@theia/core/lib/electron-browser/window/electron-window-service.js"), "utf8");

  it("is applied in the main process, on the SetZoomLevel channel, with the level as its first argument", () => {
    expect(theiaPreload).toMatch(/setZoomLevel: function \(desired, windowName\) \{\s*ipcRenderer\.send\(electron_api_1\.CHANNEL_SET_ZOOM_LEVEL, desired, windowName\);/);
    const handler = between(theiaApiMain, "ipcMain.on(electron_api_1.CHANNEL_SET_ZOOM_LEVEL,", "});");
    expect(handler).toContain("electronWindow.webContents.setZoomLevel(zoomLevel);");
  });

  // spexr's setTimeout runs after Theia's handler only because that handler
  // applies the level synchronously, within the same emit.
  it("is applied synchronously, so a turn later it has landed", () => {
    expect(theiaApiMain).toContain("ipcMain.on(electron_api_1.CHANNEL_SET_ZOOM_LEVEL, (event, zoomLevel, windowName) => {");
    const handler = between(theiaApiMain, "ipcMain.on(electron_api_1.CHANNEL_SET_ZOOM_LEVEL,", "});");
    expect(handler).not.toMatch(/\basync\b|\bawait\b|\.then\(|setTimeout|setImmediate|\bPromise\b|queueMicrotask/);
  });

  it("comes from window.zoomLevel, which Theia's zoom commands set", () => {
    const update = between(theiaWindowService, "async updateWindowZoomLevel() {", "\n    }\n");
    expect(update).toContain("window.electronTheiaCore.setZoomLevel(preferredZoomLevel);");
  });

  // spexr's listener is added in hookApplicationEvents, Theia's when its
  // main API contribution starts, later: spexr's runs first.
  it("is heard by spexr before Theia applies it", () => {
    const start = between(theiaMain, "async start(config) {", "\n    getTitleBarStyle(");
    expect(start.indexOf("this.hookApplicationEvents();")).toBeGreaterThanOrEqual(0);
    expect(start.indexOf("this.hookApplicationEvents();")).toBeLessThan(start.indexOf("this.startContributions()"));
    expect(theiaApiMain).toMatch(/class TheiaMainApi \{[\s\S]*onStart\(application\) \{[\s\S]*CHANNEL_SET_ZOOM_LEVEL/);
  });
});
