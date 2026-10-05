import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decideTitleBarStyle, TITLE_BAR_MIGRATION_KEY, type TitleBarInputs } from "./title-bar-style.js";

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

  it("keeps macOS native, whatever is stored or configured (S5b-2 brings its inset bar)", () => {
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

  it("is overridden through decideTitleBarStyle, dropping the stored frame and setting the flag", () => {
    expect(ours).toMatch(/protected override getTitleBarStyle\(config: ElectronMainApplication\["config"\]\): TitleBarStyle/);
    expect(ours).toContain("decideTitleBarStyle({");
    expect(ours).toContain('this.electronStore.set("windowstate", rest);');
    expect(ours).toContain("flags.set(TITLE_BAR_MIGRATION_KEY, true);");
  });
});
