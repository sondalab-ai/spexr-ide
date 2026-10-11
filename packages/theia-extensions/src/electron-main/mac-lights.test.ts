import { describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import { FULL_SCREEN_EVENTS, LIGHTS_BEFORE_TAHOE, LIGHTS_ROOM_PROPERTY, LIGHTS_TAHOE, type LightsGeometry } from "../common/mac-title-bar.js";
import { followZoom, MacLights, reportFullScreen, type LightsWebContents, type LightsWindow } from "./mac-lights.js";

/**
 * A BrowserWindow stand-in: events through EventEmitter, every call recorded.
 * A sheet is in the page from the moment insertCSS is called (the renderer
 * applies it on arrival); `hold` keeps the returned key pending until
 * `release`, as a slow round trip would.
 */
class FakeWindow extends EventEmitter implements LightsWindow {
  destroyed = false;
  fullScreen = false;
  zoom = 0;
  hold = false;
  /** The next insert's promise rejects; the next insert throws at once. */
  rejectNext = false;
  throwNext = false;
  positions: Array<{ x: number; y: number } | null> = [];
  sheets = new Map<string, string>();
  removed: string[] = [];
  /** Every insert and removal, in order, with the zoom level at the time. */
  log: string[] = [];
  private next = 0;
  private held: Array<() => void> = [];
  readonly contents = new EventEmitter();
  readonly webContents: LightsWebContents = {
    getZoomLevel: () => this.zoom,
    insertCSS: (css) => {
      if (this.throwNext) {
        this.throwNext = false;
        this.log.push(`throw ${roomOf(css)}`);
        throw new Error("webContents destroyed");
      }
      if (this.rejectNext) {
        this.rejectNext = false;
        this.log.push(`reject ${roomOf(css)}`);
        return Promise.reject(new Error("insertCSS failed"));
      }
      const key = `k${this.next++}`;
      this.sheets.set(key, css);
      this.log.push(`insert ${key} ${roomOf(css)} at zoom ${this.zoom}`);
      if (!this.hold) return Promise.resolve(key);
      return new Promise((resolve) => this.held.push(() => resolve(key)));
    },
    removeInsertedCSS: async (key) => {
      this.removed.push(key);
      this.log.push(`remove ${key}`);
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
  /** A new document: the old one's sheets go with it. */
  reload(): void {
    this.sheets.clear();
    this.contents.emit("dom-ready");
  }
  /** Lets every held insert return its key, in order. */
  release(): void {
    this.hold = false;
    for (const resolve of this.held.splice(0)) resolve();
  }
  /** The room the page's sheets give it now, or how many sheets there are when not one. */
  room(): string | undefined {
    const sheets = [...this.sheets.values()];
    return sheets.length === 1 ? roomOf(sheets[0]!) : `${sheets.length} sheets`;
  }
}

function roomOf(css: string): string | undefined {
  return new RegExp(`${LIGHTS_ROOM_PROPERTY}: ([^;]+);`).exec(css)?.[1];
}

/** Lets the queued stylesheet bookkeeping run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function setup(geometry: LightsGeometry = LIGHTS_BEFORE_TAHOE) {
  const lights = new MacLights(geometry);
  const window = new FakeWindow();
  const sent: string[] = [];
  lights.add(window, (event) => sent.push(event));
  window.contents.emit("dom-ready");
  await settle();
  return { lights, window, sent };
}

/** What Theia's SetZoomLevel handler and spexr's listener do, in their order. */
async function zoomTo(lights: MacLights, window: FakeWindow, level: number): Promise<void> {
  lights.prepareZoom(level);
  window.zoom = level;
  await settle();
  lights.syncAll();
  await settle();
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
    const { window } = await setup();
    expect(window.positions).toEqual([{ x: 15, y: 14 }]);
    expect(window.room()).toBe("52px");
  });

  it("follows the macOS's geometry", async () => {
    const { window } = await setup(LIGHTS_TAHOE);
    expect(window.positions).toEqual([{ x: 16, y: 15 }]);
    expect(window.room()).toBe("60px");
  });

  it("moves the lights and widens the room when the zoom changes", async () => {
    const { lights, window } = await setup();
    await zoomTo(lights, window, -1);
    expect(window.positions.at(-1)).toEqual({ x: 15, y: 10 });
    expect(window.room()).toBe("65.6px");
    await zoomTo(lights, window, 1);
    expect(window.positions.at(-1)).toEqual({ x: 15, y: 18 });
    expect(window.room()).toBe("40.67px");
  });

  // The review's transient: the page painted the new zoom with the old room
  // and the mark sat under the lights, until the sheet landed after the zoom.
  it("gives a growing room to the page before the zoom applies, from the requested level", () => {
    const lights = new MacLights(LIGHTS_BEFORE_TAHOE);
    const window = new FakeWindow();
    lights.add(window, () => undefined);
    window.contents.emit("dom-ready");
    lights.prepareZoom(-1);
    expect(window.log).toEqual(["insert k0 52px at zoom 0", "insert k1 65.6px at zoom 0"]);
  });

  // Shrunk before the zoom, the room would put the mark on the lights at the old zoom.
  it("leaves a shrinking room for after the zoom", async () => {
    const { lights, window } = await setup();
    lights.prepareZoom(1);
    expect(window.log).toEqual(["insert k0 52px at zoom 0"]);
    window.zoom = 1;
    lights.syncAll();
    await settle();
    expect(window.log.at(-2)).toBe("insert k1 40.67px at zoom 1");
  });

  it("does not insert the same room twice when the zoom lands", async () => {
    const { lights, window } = await setup();
    await zoomTo(lights, window, -1);
    expect(window.log).toEqual(["insert k0 52px at zoom 0", "insert k1 65.6px at zoom 0", "remove k0"]);
  });

  it("takes the old sheet out only once the new one is in", async () => {
    const { lights, window } = await setup();
    window.hold = true;
    window.zoom = -1;
    lights.syncAll();
    await settle();
    expect(window.removed).toEqual([]);
    window.release();
    await settle();
    expect(window.removed).toEqual(["k0"]);
    expect(window.room()).toBe("65.6px");
  });

  // A sheet still in flight when the page reloads belongs to the old
  // document: its key must not be stored, nor later removed from the new one.
  it("drops a sheet that lands after its document was replaced", async () => {
    const { lights, window } = await setup();
    window.hold = true;
    window.zoom = -1;
    lights.syncAll();
    window.reload();
    window.release();
    await settle();
    await settle();
    expect(window.removed).toEqual([]);
    expect(window.room()).toBe("65.6px");
    window.zoom = 0;
    lights.syncAll();
    await settle();
    expect(window.removed).toEqual(["k2"]);
    expect(window.room()).toBe("52px");
  });

  // A sheet that never went in must not dedupe the next try at the same css.
  it("tries a sheet again after its insert was rejected", async () => {
    const { lights, window } = await setup();
    window.rejectNext = true;
    window.zoom = -1;
    lights.syncAll();
    await settle();
    expect(window.room()).toBe("52px");
    lights.syncAll();
    await settle();
    expect(window.room()).toBe("65.6px");
  });

  // The review's overlap case: the early room rejected, then the zoom lands.
  it("gives the room after the zoom when the early insert was rejected", async () => {
    const { lights, window } = await setup();
    window.rejectNext = true;
    lights.prepareZoom(-1);
    await settle();
    window.zoom = -1;
    lights.syncAll();
    await settle();
    expect(window.room()).toBe("65.6px");
  });

  it("tries a sheet again after its insert threw", async () => {
    const { lights, window } = await setup();
    window.throwNext = true;
    window.zoom = -1;
    lights.syncAll();
    await settle();
    expect(window.room()).toBe("52px");
    lights.syncAll();
    await settle();
    expect(window.room()).toBe("65.6px");
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
    const lights = new MacLights(LIGHTS_BEFORE_TAHOE);
    const window = new FakeWindow();
    lights.add(window, () => undefined);
    window.destroyed = true;
    lights.prepareZoom(-1);
    lights.syncAll();
    window.contents.emit("dom-ready");
    await settle();
    expect(window.positions).toEqual([]);
    expect(window.sheets.size).toBe(0);
  });

  it("styles a page that loads again, without removing a sheet the old document took with it", async () => {
    const { window } = await setup();
    window.reload();
    await settle();
    expect(window.room()).toBe("52px");
    expect(window.removed).toEqual([]);
  });

  // Electron skips redrawing the lights in full screen, where they belong to
  // the system's revealed title bar; a zoom or a reload there waits.
  it("leaves the lights alone in full screen, and places them on leaving it", async () => {
    const { lights, window } = await setup();
    window.fullScreen = true;
    await zoomTo(lights, window, -1);
    window.reload();
    await settle();
    expect(window.positions).toEqual([{ x: 15, y: 14 }]);
    expect(window.room()).toBe("65.6px");
    window.fullScreen = false;
    window.emit("leave-full-screen");
    await settle();
    expect(window.positions.at(-1)).toEqual({ x: 15, y: 10 });
  });

  it("reports full screen for the windows it keeps", async () => {
    const { window, sent } = await setup();
    window.emit("enter-full-screen");
    expect(sent).toEqual([FULL_SCREEN_EVENTS.enter]);
  });
});

describe("followZoom", () => {
  /** ipcMain stand-in: spexr's listener first, then Theia's, as the main process adds them. */
  function channel(lights: Pick<MacLights, "prepareZoom" | "syncAll">) {
    const ipc = new EventEmitter();
    const later: Array<() => void> = [];
    const reported: unknown[] = [];
    const applied: unknown[] = [];
    ipc.on("SetZoomLevel", followZoom(lights, (run) => later.push(run), (error) => reported.push(error)));
    ipc.on("SetZoomLevel", (_event: unknown, level: unknown) => applied.push(level));
    return { ipc, later, reported, applied };
  }

  it("gives the early room for the requested level, then syncs a turn later", () => {
    const calls: string[] = [];
    const { ipc, later, applied } = channel({ prepareZoom: (level) => calls.push(`prepare ${level}`), syncAll: () => calls.push("sync") });
    ipc.emit("SetZoomLevel", {}, -1);
    expect(calls).toEqual(["prepare -1"]);
    expect(applied).toEqual([-1]);
    later.forEach((run) => run());
    expect(calls).toEqual(["prepare -1", "sync"]);
  });

  // An EventEmitter stops at a listener that throws: unguarded, Theia's
  // handler would never apply the zoom.
  it("lets Theia apply the zoom, and still syncs, when the early room throws", () => {
    const calls: string[] = [];
    const failure = new Error("destroyed webContents");
    const { ipc, later, reported, applied } = channel({
      prepareZoom: () => {
        throw failure;
      },
      syncAll: () => calls.push("sync"),
    });
    ipc.emit("SetZoomLevel", {}, -1);
    expect(applied).toEqual([-1]);
    expect(reported).toEqual([failure]);
    later.forEach((run) => run());
    expect(calls).toEqual(["sync"]);
  });

  it("skips the early room for a level that is not a number, and still syncs", () => {
    const calls: string[] = [];
    const { ipc, later } = channel({ prepareZoom: () => calls.push("prepare"), syncAll: () => calls.push("sync") });
    ipc.emit("SetZoomLevel", {}, "x");
    later.forEach((run) => run());
    expect(calls).toEqual(["sync"]);
  });
});
