import { describe, expect, it } from "vitest";
import { readSidebarPrefs, writeSidebarPrefs } from "./sidebar-prefs.js";

function storage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("sidebar prefs", () => {
  it("defaults to open at 340px", () => {
    expect(readSidebarPrefs(storage())).toEqual({ open: true, width: 340 });
  });
  it("round-trips and clamps the width", () => {
    const st = storage();
    writeSidebarPrefs(st, { open: false, width: 9_000 });
    expect(readSidebarPrefs(st)).toEqual({ open: false, width: 560 });
  });
  it("survives junk and a throwing storage", () => {
    expect(readSidebarPrefs(storage({ "spexr.darkfactory.scheduleSidebar": "{" }))).toEqual({ open: true, width: 340 });
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readSidebarPrefs(throwing)).toEqual({ open: true, width: 340 });
    expect(() => writeSidebarPrefs(throwing, { open: true, width: 300 })).not.toThrow();
  });
});
