import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CODE_FONT_FAMILY,
  CODE_FONT_LOADS,
  CODE_FONT_PREFERENCES,
  CODE_FONT_STACK,
  CODE_FONT_WAIT_MS,
  FONT_GATE_LOADS,
  HOLD_CODE_FONT_KEY,
  RELEASE_CODE_FONT_EVENT,
  UI_FONT_LOADS,
  afterRelease,
  families,
  firstFamily,
  gateCodeFont,
  isHeld,
  isXtermFontLike,
  remeasureTerminals,
  remeasureXterm,
  settleCodeFont,
  startCap,
  type CodeFontMark,
  type CodeFontOutcome,
  type TerminalHandle,
  type Timers,
  type XtermFontLike,
} from "./code-font.js";

/** The preference defaults the desktop app ships (theia.frontend.config.preferences). */
function desktopPreferences(): Record<string, unknown> {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../../apps/desktop/package.json", import.meta.url)), "utf8"),
  ) as { theia: { frontend: { config: { preferences: Record<string, unknown> } } } };
  return pkg.theia.frontend.config.preferences;
}

/** A custom property's value in the installed kit's tokens.css, comments removed. */
function kitToken(name: string): string | undefined {
  const effects = createRequire(import.meta.url).resolve("@sondalab/ui-kit/effects.js");
  const css = readFileSync(join(dirname(effects), "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return new RegExp(`${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
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
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

/** One face found for each requested load: what document.fonts.load gives when all is well. */
const FOUND: readonly (readonly unknown[])[] = [[{}], [{}]];

/** xterm's row height in CSS px: the measured box, scaled, times lineHeight, floored on the device grid. */
function xtermRow(box: number, lineHeight: number, dpr: number): number {
  return Math.floor(Math.ceil(box * dpr) * lineHeight) / dpr;
}

/**
 * Timers that record what is scheduled and fire only when told to. `fire`
 * runs every pending handler; a cleared one never runs.
 */
function fakeTimers() {
  const pending = new Map<number, { handler: () => void; ms: number }>();
  const scheduled: number[] = [];
  const cleared: number[] = [];
  let next = 1;
  const timers: Timers = {
    setTimeout(handler, ms) {
      const id = next++;
      pending.set(id, { handler, ms });
      scheduled.push(ms);
      return id;
    },
    clearTimeout(id) {
      if (pending.delete(id as number)) cleared.push(id as number);
    },
  };
  const fire = (): void => {
    for (const [id, { handler }] of [...pending]) {
      pending.delete(id);
      handler();
    }
  };
  return { timers, scheduled, cleared, fire, pendingCount: () => pending.size };
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

/** A stand-in terminal widget: its xterm, its visibility, and the refits Theia was asked for. */
function fakeTerminal(opts: { visible: boolean; xterm?: unknown; throwOnRefit?: boolean }) {
  const xterm = fakeXterm(CODE_FONT_STACK);
  const listeners = new Set<(visible: boolean) => void>();
  let visible = opts.visible;
  let refits = 0;
  const terminal: TerminalHandle = {
    xterm: "xterm" in opts ? opts.xterm : xterm.term,
    get isVisible() {
      return visible;
    },
    onDidChangeVisibility(listener) {
      listeners.add(listener);
      return { dispose: () => void listeners.delete(listener) };
    },
    refit() {
      if (opts.throwOnRefit) throw new Error("refit");
      refits++;
    },
  };
  const setVisible = (value: boolean): void => {
    visible = value;
    for (const listener of [...listeners]) listener(value);
  };
  return { terminal, xterm, setVisible, refits: () => refits, listeners: () => listeners.size };
}

/** Hooks that count re-measures and collect failures. */
function hooks() {
  const failures: unknown[] = [];
  let remeasured = 0;
  return {
    hooks: { remeasured: () => void remeasured++, failed: (err: unknown) => void failures.push(err) },
    remeasured: () => remeasured,
    failures,
  };
}

describe("the code face", () => {
  it("is Geist Mono, then system monos", () => {
    expect(families(CODE_FONT_STACK)).toEqual(["Geist Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"]);
    expect(CODE_FONT_FAMILY).toBe("Geist Mono");
  });

  // --sl-font-code is var(--sl-font-mono); the editor and terminal stack must
  // fall back the same way, or the two drift apart on a glyph Geist Mono lacks.
  it("is the kit's mono stack, family for family", () => {
    const mono = kitToken("--sl-font-mono");
    expect(mono).toBeDefined();
    expect(families(CODE_FONT_STACK)).toEqual(families(mono ?? ""));
  });

  it("is loaded in the regular and bold the editor and terminal draw", () => {
    expect(CODE_FONT_LOADS).toEqual(['400 13px "Geist Mono"', '700 13px "Geist Mono"']);
  });

  it("gates the UI face, Geist, in the weights spexr's chrome sets", () => {
    expect(UI_FONT_LOADS).toEqual(['400 13px "Geist"', '500 13px "Geist"', '600 13px "Geist"', '700 13px "Geist"']);
    expect(FONT_GATE_LOADS).toEqual([...CODE_FONT_LOADS, ...UI_FONT_LOADS]);
    expect(families(kitToken("--sl-font-sans") ?? "")[0]).toBe("Geist");
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

  // Exhaustive the other way too: a font metric added to package.json alone
  // (say terminal.integrated.fontWeight) would not be pinned. Word wrap and
  // the cursor shape are not font metrics and stay out.
  it("set no font metric the code face does not pin", () => {
    const metric = /^(editor|terminal\.integrated)\.(font\w*|lineHeight|letterSpacing)$/;
    const extra = Object.keys(desktopPreferences()).filter((key) => metric.test(key) && !(key in CODE_FONT_PREFERENCES));
    expect(extra).toEqual([]);
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

  // Documents the arithmetic only: the boxes are Chrome's measurements of
  // Geist Mono at 12.5px (17px at 1×, 16px at 2×); CI's probe reads the real cell.
  it("give the terminal rows within half a pixel of the demo's 18", () => {
    const lineHeight = CODE_FONT_PREFERENCES["terminal.integrated.lineHeight"];
    expect(xtermRow(17, lineHeight, 1)).toBe(18);
    expect(xtermRow(16, lineHeight, 2)).toBe(17.5);
  });
});

describe("settleCodeFont", () => {
  it("re-measures before it resolves when the faces arrive within the cap", async () => {
    const load = deferred<readonly (readonly unknown[])[]>();
    const cap = deferred<void>();
    const calls: boolean[] = [];
    const settled = settleCodeFont(load.promise, cap.promise, (late) => calls.push(late));
    load.resolve(FOUND);
    let seen: boolean[] = [];
    const outcome = await settled.then((o) => ((seen = [...calls]), o));
    expect(outcome).toBe<CodeFontOutcome>("loaded");
    expect(seen).toEqual([false]);
  });

  it("re-measures once, even when the cap fires afterwards", async () => {
    const load = deferred<readonly (readonly unknown[])[]>();
    const cap = deferred<void>();
    const calls: boolean[] = [];
    const settled = settleCodeFont(load.promise, cap.promise, (late) => calls.push(late));
    load.resolve(FOUND);
    await settled;
    cap.resolve();
    await flush();
    expect(calls).toEqual([false]);
  });

  it("goes on at the cap, then re-measures when the faces arrive", async () => {
    const load = deferred<readonly (readonly unknown[])[]>();
    const cap = deferred<void>();
    const calls: boolean[] = [];
    const settled = settleCodeFont(load.promise, cap.promise, (late) => calls.push(late));
    cap.resolve();
    expect(await settled).toBe<CodeFontOutcome>("timeout");
    expect(calls).toEqual([]);
    load.resolve(FOUND);
    await flush();
    expect(calls).toEqual([true]);
  });

  it.each(["fails", "matches nothing"])("re-measures nothing when a face that missed the cap then %s", async (how) => {
    const load = deferred<readonly (readonly unknown[])[]>();
    const cap = deferred<void>();
    const calls: boolean[] = [];
    const settled = settleCodeFont(load.promise, cap.promise, (late) => calls.push(late));
    cap.resolve();
    expect(await settled).toBe<CodeFontOutcome>("timeout");
    if (how === "fails") load.reject(new Error("network"));
    else load.resolve([[], []]);
    await flush();
    expect(calls).toEqual([]);
  });

  // document.fonts.load resolves an empty list, not a rejection, when no
  // declared face matches: the stylesheet with the @font-face never loaded.
  it.each([
    ["no face matched", [[], []]],
    ["one requested face matched nothing", [[{}], []]],
    ["nothing was asked for", []],
  ])("is missing, and re-measures nothing, when %s", async (_why, lists) => {
    const calls: boolean[] = [];
    const outcome = await settleCodeFont(Promise.resolve(lists as unknown[][]), new Promise<void>(() => undefined), (late) => calls.push(late));
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

describe("startCap", () => {
  it("resolves when its timer fires, after the given time", async () => {
    const t = fakeTimers();
    let resolved = false;
    const cap = startCap(250, t.timers);
    void cap.promise.then(() => (resolved = true));
    expect(t.scheduled).toEqual([250]);
    await flush();
    expect(resolved).toBe(false);
    t.fire();
    await flush();
    expect(resolved).toBe(true);
  });

  it("stops its timer when cancelled", () => {
    const t = fakeTimers();
    startCap(250, t.timers).cancel();
    expect(t.pendingCount()).toBe(0);
    expect(t.cleared.length).toBe(1);
  });
});

describe("gateCodeFont", () => {
  it("waits 1.5s, and no more", () => {
    expect(CODE_FONT_WAIT_MS).toBe(1500);
  });

  it("caps the wait at CODE_FONT_WAIT_MS, and at 0 when held", () => {
    for (const held of [false, true]) {
      const t = fakeTimers();
      void gateCodeFont({ load: new Promise(() => undefined), held, timers: t.timers, remeasure: () => undefined, mark: () => undefined });
      expect(t.scheduled).toEqual([held ? 0 : 1500]);
    }
  });

  it("marks loaded, re-measures, and stops the cap's timer when the faces win", async () => {
    const t = fakeTimers();
    const marks: CodeFontMark[] = [];
    const calls: boolean[] = [];
    const outcome = await gateCodeFont({
      load: Promise.resolve(FOUND),
      held: false,
      timers: t.timers,
      remeasure: (late) => calls.push(late),
      mark: (m) => marks.push(m),
    });
    expect(outcome).toBe<CodeFontOutcome>("loaded");
    expect(calls).toEqual([false]);
    expect(marks).toEqual(["loaded"]);
    expect(t.pendingCount()).toBe(0);
  });

  it("marks timeout at the cap, then late when the faces arrive", async () => {
    const t = fakeTimers();
    const load = deferred<readonly (readonly unknown[])[]>();
    const marks: CodeFontMark[] = [];
    const gated = gateCodeFont({ load: load.promise, held: false, timers: t.timers, remeasure: () => undefined, mark: (m) => marks.push(m) });
    t.fire();
    expect(await gated).toBe<CodeFontOutcome>("timeout");
    expect(marks).toEqual(["timeout"]);
    load.resolve(FOUND);
    await flush();
    expect(marks).toEqual(["timeout", "late"]);
  });

  // The faces can land in the same turn as the cap: the late re-measure then
  // runs before the gate marks its own outcome, and must not be overwritten.
  it("keeps late when the faces arrive before the timeout is marked", async () => {
    const immediate: Timers = { setTimeout: (handler) => (handler(), 0), clearTimeout: () => undefined };
    const load = deferred<readonly (readonly unknown[])[]>();
    const marks: CodeFontMark[] = [];
    const calls: boolean[] = [];
    const gated = gateCodeFont({
      load: load.promise,
      held: false,
      timers: immediate,
      remeasure: (late) => calls.push(late),
      mark: (m) => marks.push(m),
    });
    load.resolve(FOUND);
    expect(await gated).toBe<CodeFontOutcome>("timeout");
    await flush();
    expect(calls).toEqual([true]);
    expect(marks).toEqual(["late"]);
  });
});

describe("the visual capture's hold switch", () => {
  it("is off unless the key is exactly 1, and off when storage throws", () => {
    expect(isHeld(undefined)).toBe(false);
    expect(isHeld({ getItem: () => null })).toBe(false);
    expect(isHeld({ getItem: () => "true" })).toBe(false);
    expect(isHeld({ getItem: (key) => (key === HOLD_CODE_FONT_KEY ? "1" : null) })).toBe(true);
    expect(
      isHeld({
        getItem: () => {
          throw new Error("SecurityError");
        },
      }),
    ).toBe(false);
  });

  it("asks for the faces only once the release event arrives", async () => {
    const target = new EventTarget();
    let started = 0;
    const held = afterRelease(target, async () => (started++, FOUND));
    await flush();
    expect(started).toBe(0);
    target.dispatchEvent(new Event(RELEASE_CODE_FONT_EVENT));
    expect(await held).toEqual(FOUND);
    target.dispatchEvent(new Event(RELEASE_CODE_FONT_EVENT));
    expect(started).toBe(1);
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

describe("remeasureTerminals", () => {
  it("re-measures and refits every visible terminal now", () => {
    const a = fakeTerminal({ visible: true });
    const b = fakeTerminal({ visible: true });
    const h = hooks();
    expect(remeasureTerminals([a.terminal, b.terminal], h.hooks)).toBe(0);
    expect(h.remeasured()).toBe(2);
    expect([a.refits(), b.refits()]).toEqual([1, 1]);
    expect(a.xterm.changes.length).toBeGreaterThan(0);
  });

  // display: none measures zero, and xterm keeps the box it had; showing the
  // terminal later refits to that same stale box. So a hidden one waits.
  it("leaves a hidden terminal alone, then re-measures it once when it is shown", () => {
    const hidden = fakeTerminal({ visible: false });
    const h = hooks();
    expect(remeasureTerminals([hidden.terminal], h.hooks)).toBe(1);
    expect(h.remeasured()).toBe(0);
    expect(hidden.xterm.changes).toEqual([]);
    expect(hidden.refits()).toBe(0);

    hidden.setVisible(false);
    expect(h.remeasured()).toBe(0);
    hidden.setVisible(true);
    expect(h.remeasured()).toBe(1);
    expect(hidden.refits()).toBe(1);
    expect(hidden.xterm.changes.length).toBeGreaterThan(0);
    expect(hidden.listeners()).toBe(0);

    hidden.setVisible(false);
    hidden.setVisible(true);
    expect(h.remeasured()).toBe(1);
  });

  it("goes on past a terminal that throws, and reports it", () => {
    const broken = fakeTerminal({ visible: true, throwOnRefit: true });
    const fine = fakeTerminal({ visible: true });
    const h = hooks();
    remeasureTerminals([broken.terminal, fine.terminal], h.hooks);
    expect(h.failures.length).toBe(1);
    expect(h.remeasured()).toBe(1);
    expect(fine.refits()).toBe(1);
  });

  // The deferred re-measure runs inside Theia's visibility event: a throw
  // there must be reported, not thrown into the widget's show.
  it("reports, and does not throw, when a hidden terminal fails once shown", () => {
    const hidden = fakeTerminal({ visible: false, throwOnRefit: true });
    const h = hooks();
    remeasureTerminals([hidden.terminal], h.hooks);
    let thrown: unknown;
    try {
      hidden.setVisible(true);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeUndefined();
    expect(h.failures.length).toBe(1);
    expect(h.remeasured()).toBe(0);
  });

  it("goes on past a terminal whose visibility cannot be read", () => {
    const fine = fakeTerminal({ visible: true });
    const broken: TerminalHandle = {
      xterm: fakeXterm(CODE_FONT_STACK).term,
      get isVisible(): boolean {
        throw new Error("disposed");
      },
      onDidChangeVisibility: () => ({ dispose: () => undefined }),
      refit: () => undefined,
    };
    const h = hooks();
    remeasureTerminals([broken, fine.terminal], h.hooks);
    expect(h.failures.length).toBe(1);
    expect(h.remeasured()).toBe(1);
  });

  it("counts only terminals actually re-measured", () => {
    const noXterm = fakeTerminal({ visible: true, xterm: undefined });
    const noFamily = fakeTerminal({ visible: true, xterm: fakeXterm(undefined).term });
    const hidden = fakeTerminal({ visible: false });
    const h = hooks();
    remeasureTerminals([noXterm.terminal, noFamily.terminal, hidden.terminal], h.hooks);
    expect(h.remeasured()).toBe(0);
    expect([noXterm.refits(), noFamily.refits()]).toEqual([0, 0]);
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
