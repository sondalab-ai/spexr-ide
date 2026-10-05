import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CODE_FONT_FAMILY,
  CODE_FONT_LOADS,
  CODE_FONT_PREFERENCES,
  CODE_FONT_STACK,
  firstFamily,
  isXtermFontLike,
  remeasureXterm,
  settleCodeFont,
  type CodeFontOutcome,
  type XtermFontLike,
} from "./code-font.js";

/** The preference defaults the desktop app ships (theia.frontend.config.preferences). */
function desktopPreferences(): Record<string, unknown> {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../../apps/desktop/package.json", import.meta.url)), "utf8"),
  ) as { theia: { frontend: { config: { preferences: Record<string, unknown> } } } };
  return pkg.theia.frontend.config.preferences;
}

/** A promise settled from outside, to put the load and the cap in a chosen order. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every queued promise callback run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** xterm's row height in CSS px: the measured box, scaled, times lineHeight, floored on the device grid. */
function xtermRow(box: number, lineHeight: number, dpr: number): number {
  return Math.floor(Math.ceil(box * dpr) * lineHeight) / dpr;
}

/**
 * A stand-in xterm whose option setter behaves like xterm 5.3's OptionsService:
 * a write of the value already held fires nothing. Each fired change is what
 * makes xterm measure the box again.
 */
function fakeXterm(fontFamily: string | undefined, withAtlas = true) {
  const changes: string[] = [];
  let family = fontFamily;
  let atlasCleared = 0;
  const options = {
    get fontFamily(): string | undefined {
      return family;
    },
    set fontFamily(value: string | undefined) {
      if (value === family) return;
      family = value;
      changes.push(String(value));
    },
  };
  const term: XtermFontLike = withAtlas ? { options, clearTextureAtlas: () => void atlasCleared++ } : { options };
  return { term, changes, atlasCleared: () => atlasCleared };
}

describe("the code face", () => {
  it("is Geist Mono, then system monos", () => {
    expect(CODE_FONT_STACK).toBe("'Geist Mono', 'SF Mono', Menlo, Consolas, monospace");
    expect(CODE_FONT_FAMILY).toBe("Geist Mono");
  });

  it("is loaded in the regular and bold the editor and terminal draw", () => {
    expect(CODE_FONT_LOADS).toEqual(['400 13px "Geist Mono"', '700 13px "Geist Mono"']);
  });

  it("reads a stack's first family without its quotes", () => {
    expect(firstFamily(`"Berkeley Mono", monospace`)).toBe("Berkeley Mono");
    expect(firstFamily("Menlo, monospace")).toBe("Menlo");
  });
});

// The desktop app's defaults are what every install starts from; they must be
// the values the code face was tuned to, in one place.
describe("the desktop app's code font preferences", () => {
  it("are the code face's", () => {
    const prefs = desktopPreferences();
    for (const [key, value] of Object.entries(CODE_FONT_PREFERENCES)) {
      expect(prefs[key], key).toBe(value);
    }
  });

  it("put the editor at 13px on a 22px line, with no extra spacing or ligatures", () => {
    expect(CODE_FONT_PREFERENCES["editor.fontSize"]).toBe(13);
    expect(CODE_FONT_PREFERENCES["editor.lineHeight"]).toBe(22);
    expect(CODE_FONT_PREFERENCES["editor.letterSpacing"]).toBe(0);
    expect(CODE_FONT_PREFERENCES["editor.fontLigatures"]).toBe(false);
  });

  it("give the terminal the editor's face, at 12.5px, with xterm's own spacing", () => {
    expect(CODE_FONT_PREFERENCES["terminal.integrated.fontFamily"]).toBe(CODE_FONT_PREFERENCES["editor.fontFamily"]);
    expect(CODE_FONT_PREFERENCES["terminal.integrated.fontSize"]).toBe(12.5);
    // Theia's default is 1px, which xterm adds to every cell.
    expect(CODE_FONT_PREFERENCES["terminal.integrated.letterSpacing"]).toBe(0);
  });

  // Geist Mono at 12.5px measures a 17px box at 1× and 16px at 2× in Chrome.
  it("give the terminal rows within half a pixel of the demo's 18", () => {
    const lineHeight = CODE_FONT_PREFERENCES["terminal.integrated.lineHeight"];
    expect(xtermRow(17, lineHeight, 1)).toBe(18);
    expect(xtermRow(16, lineHeight, 2)).toBe(17.5);
  });
});

describe("settleCodeFont", () => {
  it("re-measures before it resolves when the face arrives within the cap", async () => {
    const load = deferred<readonly unknown[]>();
    const cap = deferred<void>();
    const calls: boolean[] = [];
    const settled = settleCodeFont(load.promise, cap.promise, (late) => calls.push(late));
    load.resolve([{}]);
    let seen: boolean[] = [];
    const outcome = await settled.then((o) => ((seen = [...calls]), o));
    expect(outcome).toBe<CodeFontOutcome>("loaded");
    expect(seen).toEqual([false]);
  });

  it("re-measures once, even when the cap fires afterwards", async () => {
    const load = deferred<readonly unknown[]>();
    const cap = deferred<void>();
    const calls: boolean[] = [];
    const settled = settleCodeFont(load.promise, cap.promise, (late) => calls.push(late));
    load.resolve([{}]);
    await settled;
    cap.resolve();
    await flush();
    expect(calls).toEqual([false]);
  });

  it("goes on at the cap, then re-measures when the face arrives", async () => {
    const load = deferred<readonly unknown[]>();
    const cap = deferred<void>();
    const calls: boolean[] = [];
    const settled = settleCodeFont(load.promise, cap.promise, (late) => calls.push(late));
    cap.resolve();
    expect(await settled).toBe<CodeFontOutcome>("timeout");
    expect(calls).toEqual([]);
    load.resolve([{}]);
    await flush();
    expect(calls).toEqual([true]);
  });

  it.each(["fails", "matches nothing"])("re-measures nothing when a face that missed the cap then %s", async (how) => {
    const load = deferred<readonly unknown[]>();
    const cap = deferred<void>();
    const calls: boolean[] = [];
    const settled = settleCodeFont(load.promise, cap.promise, (late) => calls.push(late));
    cap.resolve();
    expect(await settled).toBe<CodeFontOutcome>("timeout");
    if (how === "fails") load.reject(new Error("network"));
    else load.resolve([]);
    await flush();
    expect(calls).toEqual([]);
  });

  // document.fonts.load resolves an empty list, not a rejection, when no
  // declared face matches: the stylesheet with the @font-face never loaded.
  it("is missing, and re-measures nothing, when no face matched", async () => {
    const calls: boolean[] = [];
    const outcome = await settleCodeFont(Promise.resolve([]), new Promise<void>(() => undefined), (late) => calls.push(late));
    expect(outcome).toBe<CodeFontOutcome>("missing");
    expect(calls).toEqual([]);
  });

  it("has failed, and re-measures nothing, when the load is refused", async () => {
    const calls: boolean[] = [];
    const outcome = await settleCodeFont(Promise.reject(new Error("decode")), new Promise<void>(() => undefined), (late) => calls.push(late));
    expect(outcome).toBe<CodeFontOutcome>("failed");
    expect(calls).toEqual([]);
  });
});

describe("remeasureXterm", () => {
  it("makes xterm see a font change, and leaves the family it had", () => {
    const xterm = fakeXterm(CODE_FONT_STACK);
    expect(remeasureXterm(xterm.term)).toBe(true);
    expect(xterm.term.options.fontFamily).toBe(CODE_FONT_STACK);
    // A plain re-set would fire nothing; the round trip fires the measure.
    expect(xterm.changes.length).toBeGreaterThan(0);
    expect(xterm.changes[xterm.changes.length - 1]).toBe(CODE_FONT_STACK);
  });

  it("keeps a per-family override rather than the global stack", () => {
    const xterm = fakeXterm("Berkeley Mono");
    remeasureXterm(xterm.term);
    expect(xterm.term.options.fontFamily).toBe("Berkeley Mono");
  });

  it("clears the shared glyph atlas the fallback face was drawn into", () => {
    const xterm = fakeXterm(CODE_FONT_STACK);
    remeasureXterm(xterm.term);
    expect(xterm.atlasCleared()).toBe(1);
  });

  it("still re-measures a terminal with no atlas to clear", () => {
    const xterm = fakeXterm(CODE_FONT_STACK, false);
    expect(remeasureXterm(xterm.term)).toBe(true);
    expect(xterm.changes.length).toBeGreaterThan(0);
  });

  it("touches nothing when the terminal has no family", () => {
    for (const family of [undefined, ""]) {
      const xterm = fakeXterm(family);
      expect(remeasureXterm(xterm.term)).toBe(false);
      expect(xterm.changes).toEqual([]);
      expect(xterm.atlasCleared()).toBe(0);
    }
  });
});

describe("isXtermFontLike", () => {
  it("accepts an object with options, and nothing else", () => {
    expect(isXtermFontLike({ options: {} })).toBe(true);
    expect(isXtermFontLike(undefined)).toBe(false);
    expect(isXtermFontLike({})).toBe(false);
    expect(isXtermFontLike({ options: null })).toBe(false);
  });
});
