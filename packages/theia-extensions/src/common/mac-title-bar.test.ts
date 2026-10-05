import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  darwinMajor,
  followFullScreen,
  FULL_SCREEN_EVENTS,
  LIGHTS_BEFORE_TAHOE,
  LIGHTS_ROOM_PROPERTY,
  LIGHTS_TAHOE,
  lightsGeometry,
  lightsRight,
  lightsRoom,
  lightsRoomCss,
  lightsWidth,
  macWindowChrome,
  TITLE_BAR_HEIGHT,
  TITLE_BAR_PADDING,
  trafficLightInset,
  trafficLightPosition,
  zoomFactor,
  type FullScreenSource,
  type LightsGeometry,
} from "./mac-title-bar.js";

/** Theia's zoom levels from -3 to +3 in its 0.5 steps. */
const LEVELS = Array.from({ length: 13 }, (_, i) => -3 + i / 2);

/** Where a geometry's first circle and its centre land for a position. */
function circles(geometry: LightsGeometry, position: { x: number; y: number }) {
  return {
    left: position.x + geometry.circle.insetX,
    centreY: position.y + geometry.circle.insetY + geometry.circle.size / 2,
    container: geometry.frame.height + 2 * position.y,
  };
}

describe("the lights' geometry", () => {
  // S5b-1's macos-14 capture (native-base-window.png, a standard 28pt title
  // bar): 12pt circles at x 8, 28 and 48, rows 8 to 19. AppKit centres the
  // 16pt frames in that bar (y 6) at x 7, so a circle is 1pt in and 2pt down.
  it("before macOS 26 is the macos-14 runner's", () => {
    const g = LIGHTS_BEFORE_TAHOE;
    expect((28 - g.frame.height) / 2 + g.circle.insetY).toBe(8);
    expect([0, 1, 2].map((i) => 7 + g.circle.insetX + i * g.pitch)).toEqual([8, 28, 48]);
    expect(g.circle.size).toBe(12);
  });

  it("from macOS 26 has VS Code's 14pt frame", () => {
    expect(LIGHTS_TAHOE.frame.height).toBe(14);
  });

  it.each([
    ["23.6.0", 23, LIGHTS_BEFORE_TAHOE],
    ["24.1.0", 24, LIGHTS_BEFORE_TAHOE],
    ["25.0.0", 25, LIGHTS_TAHOE],
    ["25.6.0", 25, LIGHTS_TAHOE],
    ["26.0.0", 26, LIGHTS_TAHOE],
    ["", 0, LIGHTS_BEFORE_TAHOE],
  ])("Darwin %s is major %s", (release, major, geometry) => {
    expect(darwinMajor(release)).toBe(major);
    expect(lightsGeometry(darwinMajor(release))).toBe(geometry);
  });

  it("is 52pt across the three circles, ending at x 68", () => {
    for (const g of [LIGHTS_BEFORE_TAHOE, LIGHTS_TAHOE]) {
      expect(lightsWidth(g)).toBe(52);
      expect(lightsRight(g)).toBe(68);
    }
  });
});

describe("trafficLightPosition", () => {
  it.each([
    ["before macOS 26", LIGHTS_BEFORE_TAHOE, { x: 15, y: 14 }],
    ["from macOS 26", LIGHTS_TAHOE, { x: 15, y: 15 }],
  ])("%s at 100% starts the first circle on the bar's padding and centres it on the bar", (_name, geometry, position) => {
    const at = trafficLightPosition(geometry);
    expect(at).toEqual(position);
    expect(circles(geometry, at).left).toBe(TITLE_BAR_PADDING);
    expect(circles(geometry, at).centreY).toBe(TITLE_BAR_HEIGHT / 2);
  });

  // Electron sizes the system's title bar container from the live frame;
  // equal to the bar, the whole bar is title bar for double-click, and none
  // of the page below it is.
  it("makes the system's container the bar at 100%", () => {
    for (const g of [LIGHTS_BEFORE_TAHOE, LIGHTS_TAHOE]) expect(circles(g, trafficLightPosition(g)).container).toBe(TITLE_BAR_HEIGHT);
  });

  it("follows the bar's centre through every zoom level, the container within a point of the bar", () => {
    for (const g of [LIGHTS_BEFORE_TAHOE, LIGHTS_TAHOE]) {
      for (const level of LEVELS) {
        const barPt = TITLE_BAR_HEIGHT * zoomFactor(level);
        const at = trafficLightPosition(g, zoomFactor(level));
        expect(Number.isInteger(at.y), `level ${level}`).toBe(true);
        expect(at.x, `level ${level}`).toBe(TITLE_BAR_PADDING - g.circle.insetX);
        expect(Math.abs(circles(g, at).centreY - barPt / 2), `level ${level}`).toBeLessThanOrEqual(0.5);
        expect(Math.abs(circles(g, at).container - barPt), `level ${level}`).toBeLessThanOrEqual(1);
      }
    }
  });

  // The review's figures for the fixed position: 3.7 to 4.4pt off at ±1.
  it("moves the lights at ±1 level, where a fixed position sits 4pt off the bar's centre", () => {
    const g = LIGHTS_BEFORE_TAHOE;
    expect(trafficLightPosition(g, zoomFactor(-1)).y).toBe(10);
    expect(trafficLightPosition(g, zoomFactor(1)).y).toBe(18);
  });
});

describe("lightsRoom", () => {
  it("is the three lights' width at 100%", () => {
    expect(lightsRoom(LIGHTS_BEFORE_TAHOE, 1)).toBe(52);
    expect(zoomFactor(0)).toBe(1);
  });

  // The page's gap after the room scales with the page; the lights do not.
  it("keeps the mark a gap clear of the lights at every zoom level", () => {
    const gapPx = 12;
    for (const g of [LIGHTS_BEFORE_TAHOE, LIGHTS_TAHOE]) {
      for (const level of LEVELS) {
        const f = zoomFactor(level);
        const markPt = (TITLE_BAR_PADDING + lightsRoom(g, f) + gapPx) * f;
        expect(markPt - lightsRight(g), `level ${level}`).toBeCloseTo(gapPx * f, 6);
      }
    }
  });

  // The review's case: at 83% a fixed 52px room put the mark 1.3pt under the lights.
  it("widens the room at 83%", () => {
    const f = zoomFactor(-1);
    expect((TITLE_BAR_PADDING + 52 + 12) * f - lightsRight(LIGHTS_BEFORE_TAHOE)).toBeLessThan(0);
    expect(lightsRoom(LIGHTS_BEFORE_TAHOE, f)).toBeCloseTo(65.6, 6);
  });

  it("never goes negative at an extreme zoom", () => {
    expect(lightsRoom(LIGHTS_BEFORE_TAHOE, zoomFactor(9))).toBe(0);
  });

  it("reaches the page as a :root custom property, to the hundredth of a pixel", () => {
    expect(lightsRoomCss(lightsRoom(LIGHTS_BEFORE_TAHOE, zoomFactor(-1)))).toBe(`:root { ${LIGHTS_ROOM_PROPERTY}: 65.6px; }`);
    expect(lightsRoomCss(52)).toBe(`:root { ${LIGHTS_ROOM_PROPERTY}: 52px; }`);
  });
});

describe("macWindowChrome", () => {
  it("hides macOS's title bar and places the lights for the running macOS", () => {
    expect(macWindowChrome("darwin", "23.6.0")).toEqual({ titleBarStyle: "hiddenInset", trafficLightPosition: { x: 15, y: 14 } });
    expect(macWindowChrome("darwin", "25.6.0")).toEqual({ titleBarStyle: "hiddenInset", trafficLightPosition: { x: 15, y: 15 } });
  });

  it("adds nothing elsewhere, leaving S5b-1's frame alone", () => {
    for (const platform of ["linux", "win32", "freebsd"]) expect(Object.keys(macWindowChrome(platform, "25.6.0")), platform).toHaveLength(0);
  });
});

describe("trafficLightInset", () => {
  it.each([
    [true, false, true],
    [true, true, false],
    [false, false, false],
    [false, true, false],
  ])("on macOS %s, full screen %s: %s", (mac, fullScreen, inset) => {
    expect(trafficLightInset(mac, fullScreen)).toBe(inset);
  });
});

/** A stand-in for electronTheiaCore: records the order of calls and fires events by name. */
function fakeCore(fullScreen: boolean) {
  const calls: string[] = [];
  const handlers = new Map<string, () => void>();
  const core: FullScreenSource = {
    onWindowEvent(event, handler) {
      calls.push(`subscribe ${event}`);
      handlers.set(event, handler);
      return { dispose: () => undefined };
    },
    isFullScreen() {
      calls.push("read");
      return fullScreen;
    },
  };
  return { core, calls, fire: (event: string) => handlers.get(event)?.() };
}

describe("followFullScreen", () => {
  it("drops the room on entering full screen and gives it back on leaving", () => {
    const { core, fire } = fakeCore(false);
    const shown: boolean[] = [];
    followFullScreen(true, core, (lights) => shown.push(lights));
    fire(FULL_SCREEN_EVENTS.enter);
    fire(FULL_SCREEN_EVENTS.leave);
    expect(shown).toEqual([true, false, true]);
  });

  it("subscribes to both transitions before it reads the state", () => {
    const { core, calls } = fakeCore(true);
    const shown: boolean[] = [];
    followFullScreen(true, core, (lights) => shown.push(lights));
    expect(calls).toEqual([`subscribe ${FULL_SCREEN_EVENTS.enter}`, `subscribe ${FULL_SCREEN_EVENTS.leave}`, "read"]);
    expect(shown).toEqual([false]);
  });

  it("does nothing off macOS", () => {
    const { core, calls } = fakeCore(false);
    const shown: boolean[] = [];
    followFullScreen(false, core, (lights) => shown.push(lights));
    expect(calls).toEqual([]);
    expect(shown).toEqual([]);
  });
});

describe("the full-screen events", () => {
  const api = readFileSync(createRequire(import.meta.url).resolve("@theia/core/lib/electron-common/electron-api.d.ts"), "utf8");

  it("are two names of spexr's own", () => {
    expect(FULL_SCREEN_EVENTS.enter).not.toBe(FULL_SCREEN_EVENTS.leave);
    for (const name of Object.values(FULL_SCREEN_EVENTS)) expect(name).toMatch(/^spexr-/);
  });

  // If Theia gains a full-screen window event, the main process's forwarding
  // can go and the frontend can listen to Theia's.
  it("stand in for a full-screen event Theia does not have", () => {
    const union = /export type WindowEvent = ([^;]+);/.exec(api)?.[1];
    expect(union, "Theia's WindowEvent").toBeDefined();
    expect(union).toBe("'maximize' | 'unmaximize' | 'focus'");
    for (const name of Object.values(FULL_SCREEN_EVENTS)) expect(union).not.toContain(name);
  });
});
