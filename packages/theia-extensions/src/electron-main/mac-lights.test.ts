import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { FULL_SCREEN_EVENTS, LIGHTS_BEFORE_TAHOE, LIGHTS_ROOM_PROPERTY, LIGHTS_TAHOE, type LightsGeometry } from "../common/mac-title-bar.js";
import { MacLights, reportFullScreen, type LightsWebContents, type LightsWindow } from "./mac-lights.js";

/** A BrowserWindow stand-in: events through EventEmitter, every call recorded. */
class FakeWindow extends EventEmitter implements LightsWindow {
  destroyed = false;
  fullScreen = false;
  zoom = 0;
  positions: Array<{ x: number; y: number } | null> = [];
  sheets = new Map<string, string>();
  removed: string[] = [];
  private next = 0;
  readonly contents = new EventEmitter();
  readonly webContents: LightsWebContents = {
    getZoomLevel: () => this.zoom,
    insertCSS: async (css) => {
      const key = `k${this.next++}`;
      this.sheets.set(key, css);
      return key;
    },
    removeInsertedCSS: async (key) => {
      this.removed.push(key);
      this.sheets.delete(key);
    },
    on: (event, listener) => this.contents.on(event, listener),
  };
  isDestroyed(): boolean {
    return this.destroyed;
  }
  isFullScreen(): boolean {
    return this.fullScreen;
  }
  setWindowButtonPosition(position: { x: number; y: number } | null): void {
    this.positions.push(position);
  }
  /** The room the page's stylesheets give it now, or undefined with none. */
  room(): string | undefined {
    const sheets = [...this.sheets.values()];
    return sheets.length === 1 ? new RegExp(`${LIGHTS_ROOM_PROPERTY}: ([^;]+);`).exec(sheets[0]!)?.[1] : `${sheets.length} sheets`;
  }
}

/** Lets the queued stylesheet swaps run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function setup(geometry: LightsGeometry = LIGHTS_BEFORE_TAHOE) {
  const lights = new MacLights(geometry);
  const window = new FakeWindow();
  const sent: string[] = [];
  lights.add(window, (event) => sent.push(event));
  return { lights, window, sent };
}

describe("reportFullScreen", () => {
  it("forwards both transitions under spexr's names", () => {
    const window = new FakeWindow();
    const sent: string[] = [];
    reportFullScreen(window, (event) => sent.push(event));
    window.emit("enter-full-screen");
    window.emit("leave-full-screen");
    expect(sent).toEqual([FULL_SCREEN_EVENTS.enter, FULL_SCREEN_EVENTS.leave]);
  });

  it("sends nothing to a window already destroyed", () => {
    const window = new FakeWindow();
    const sent: string[] = [];
    reportFullScreen(window, (event) => sent.push(event));
    window.destroyed = true;
    window.emit("enter-full-screen");
    window.emit("leave-full-screen");
    expect(sent).toEqual([]);
  });
});

describe("MacLights", () => {
  it("places the lights and gives the page their room when the page is ready", async () => {
    const { window } = setup();
    window.contents.emit("dom-ready");
    await settle();
    expect(window.positions).toEqual([{ x: 15, y: 14 }]);
    expect(window.room()).toBe("52px");
  });

  it("follows the macOS's geometry", async () => {
    const { window } = setup(LIGHTS_TAHOE);
    window.contents.emit("dom-ready");
    await settle();
    expect(window.positions).toEqual([{ x: 16, y: 15 }]);
    expect(window.room()).toBe("60px");
  });

  it("moves the lights and widens the room when the zoom changes, one stylesheet at a time", async () => {
    const { lights, window } = setup();
    window.contents.emit("dom-ready");
    await settle();
    window.zoom = -1;
    lights.syncAll();
    await settle();
    expect(window.positions.at(-1)).toEqual({ x: 15, y: 10 });
    expect(window.room()).toBe("65.6px");
    expect(window.removed).toEqual(["k0"]);
    window.zoom = 1;
    lights.syncAll();
    await settle();
    expect(window.positions.at(-1)).toEqual({ x: 15, y: 18 });
    expect(window.room()).toBe("40.67px");
  });

  // Chromium zooms every window of an origin, so one change moves them all.
  it("syncs every window it keeps, and forgets a closed one", async () => {
    const lights = new MacLights(LIGHTS_BEFORE_TAHOE);
    const [a, b] = [new FakeWindow(), new FakeWindow()];
    lights.add(a, () => undefined);
    lights.add(b, () => undefined);
    b.emit("closed");
    a.zoom = b.zoom = -1;
    lights.syncAll();
    await settle();
    expect(a.positions).toEqual([{ x: 15, y: 10 }]);
    expect(b.positions).toEqual([]);
  });

  it("leaves a destroyed window alone", async () => {
    const { lights, window } = setup();
    window.destroyed = true;
    lights.syncAll();
    window.contents.emit("dom-ready");
    await settle();
    expect(window.positions).toEqual([]);
    expect(window.sheets.size).toBe(0);
  });

  // A reload drops the injected sheet with the old document; the new one gets its own.
  it("styles a page that loads again, without removing a sheet the old document took with it", async () => {
    const { window } = setup();
    window.contents.emit("dom-ready");
    await settle();
    window.sheets.clear();
    window.contents.emit("dom-ready");
    await settle();
    expect(window.room()).toBe("52px");
    expect(window.removed).toEqual([]);
  });

  // Electron skips redrawing the lights in full screen, where they belong to
  // the system's revealed title bar; a zoom or a reload there waits.
  it("leaves the lights alone in full screen, and places them on leaving it", async () => {
    const { lights, window } = setup();
    window.fullScreen = true;
    window.zoom = -1;
    lights.syncAll();
    window.contents.emit("dom-ready");
    await settle();
    expect(window.positions).toEqual([]);
    expect(window.room()).toBe("65.6px");
    window.fullScreen = false;
    window.emit("leave-full-screen");
    await settle();
    expect(window.positions).toEqual([{ x: 15, y: 10 }]);
  });

  it("reports full screen for the windows it keeps", () => {
    const { window, sent } = setup();
    window.emit("enter-full-screen");
    expect(sent).toEqual([FULL_SCREEN_EVENTS.enter]);
  });
});
