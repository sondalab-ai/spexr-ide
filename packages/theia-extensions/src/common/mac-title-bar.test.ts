import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  FULL_SCREEN_EVENTS,
  LIGHT_CIRCLE,
  LIGHT_FRAME,
  LIGHT_PITCH,
  macWindowChrome,
  TITLE_BAR_HEIGHT,
  TITLE_BAR_PADDING,
  TRAFFIC_LIGHT_POSITION,
  TRAFFIC_LIGHTS_WIDTH,
  trafficLightInset,
} from "./mac-title-bar.js";

describe("macOS's traffic lights in the bar", () => {
  // S5b-1's macos-14 capture (native-base-window.png, a standard 28px title
  // bar): 12px circles at x 8, 28 and 48, rows 8 to 19. AppKit centres the
  // 16px frames in that bar (y 6) at x 7, so a circle is 1px in and 2px down.
  it("matches the system's button geometry, as measured on the runner", () => {
    const standardBar = 28;
    const frameTop = (standardBar - LIGHT_FRAME.height) / 2;
    expect(frameTop + LIGHT_CIRCLE.insetY).toBe(8);
    expect([0, 1, 2].map((i) => 7 + LIGHT_CIRCLE.insetX + i * LIGHT_PITCH)).toEqual([8, 28, 48]);
    expect(LIGHT_CIRCLE.size).toBe(12);
  });

  it("starts the first light on the bar's padding", () => {
    expect(TRAFFIC_LIGHT_POSITION.x + LIGHT_CIRCLE.insetX).toBe(TITLE_BAR_PADDING);
    expect(TRAFFIC_LIGHT_POSITION).toEqual({ x: 15, y: 14 });
  });

  it("centres the lights on the 44px bar", () => {
    const circleTop = TRAFFIC_LIGHT_POSITION.y + LIGHT_CIRCLE.insetY;
    expect(circleTop + LIGHT_CIRCLE.size / 2).toBe(TITLE_BAR_HEIGHT / 2);
  });

  // Electron's WindowButtonsProxy sizes the system's title bar container to
  // the frame's height plus the position's y above and below; inside it, a
  // double-click on the bar is AppKit's own (zoom or minimize).
  it("makes the system's title bar container exactly the bar", () => {
    expect(LIGHT_FRAME.height + 2 * TRAFFIC_LIGHT_POSITION.y).toBe(TITLE_BAR_HEIGHT);
  });

  it("measures 52px across the three circles", () => {
    expect(TRAFFIC_LIGHTS_WIDTH).toBe(52);
  });
});

describe("macWindowChrome", () => {
  it("hides macOS's title bar and places the lights", () => {
    expect(macWindowChrome("darwin")).toEqual({ titleBarStyle: "hiddenInset", trafficLightPosition: { x: 15, y: 14 } });
  });

  it("adds nothing elsewhere, leaving S5b-1's frame alone", () => {
    for (const platform of ["linux", "win32", "freebsd"]) expect(Object.keys(macWindowChrome(platform)), platform).toHaveLength(0);
  });

  it("hands out a copy of the position, never the constant", () => {
    const chrome = macWindowChrome("darwin");
    expect(chrome.trafficLightPosition).not.toBe(TRAFFIC_LIGHT_POSITION);
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
