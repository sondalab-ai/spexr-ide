/**
 * The code face: Geist Mono in the editor and the terminal (owner, 2026-10-05,
 * reversing JetBrains Mono from 2026-10-02). The stack is the kit's own
 * `--sl-font-mono`, family for family, so the editor, the terminal and every
 * `--sl-font-code` surface fall back the same way; a test keeps the two from
 * drifting, and another keeps `apps/desktop/package.json` on this one.
 * Geist Mono is bundled (the kit's fonts.css, inlined by the build); the rest
 * of the stack only serves a glyph the face lacks.
 */
export const CODE_FONT_STACK = "'Geist Mono', ui-monospace, 'SF Mono', Menlo, monospace";

/**
 * The defaults `apps/desktop/package.json` gives the code face; a test holds
 * the two together. The Lumen demo sets its code in 13px on a 22px line, and
 * its terminal in 12.5px on rows of about 18px.
 *
 * Ligatures are off because there are none: the bundled Geist Mono has no
 * `liga` or `calt` feature, and xterm draws none either.
 *
 * The terminal's line height is not CSS's. xterm multiplies the character box
 * it measured (the face's ascent plus descent, rounded), not the font size:
 * `row = floor(ceil(box × dpr) × lineHeight) / dpr`. Geist Mono at 12.5px
 * measures a 17px box at 1× and 16px at 2× (Chrome, 2026-10-05), so 1.1 gives
 * 18px rows at 1× and 17.5px at 2×. No one value gives 18 at both: that needs
 * [1.059, 1.118) at 1× and [1.125, 1.156) at 2×.
 */
export const CODE_FONT_PREFERENCES = {
  "editor.fontFamily": CODE_FONT_STACK,
  "editor.fontSize": 13,
  "editor.lineHeight": 22,
  "editor.letterSpacing": 0,
  "editor.fontLigatures": false,
  "terminal.integrated.fontFamily": CODE_FONT_STACK,
  "terminal.integrated.fontSize": 12.5,
  "terminal.integrated.lineHeight": 1.1,
  "terminal.integrated.letterSpacing": 0,
} as const;

/** The stack's first family, unquoted: the face start-up waits for. */
export const CODE_FONT_FAMILY = firstFamily(CODE_FONT_STACK);

/** The UI face (the kit's `--sl-font-sans`), which Theia's chrome is set in. */
export const UI_FONT_FAMILY = "Geist";

/**
 * What `document.fonts.load` is asked for. The code face in the regular and
 * bold the editor and terminal draw: Monaco and xterm measure it once and
 * keep it, so these loads decide the outcome and the re-measure. The UI face
 * in the weights spexr's chrome sets, so tab bars and toolbars lay out in it
 * from the first frame: waited for within the same cap, best effort, and
 * never part of the outcome. Each bundled face is one variable file, so any
 * one load brings in every weight; asking for each keeps that true if the
 * kit ever splits a file.
 */
export const CODE_FONT_LOADS: readonly string[] = [
  `400 13px "${CODE_FONT_FAMILY}"`,
  `700 13px "${CODE_FONT_FAMILY}"`,
];
export const UI_FONT_LOADS: readonly string[] = ["400", "500", "600", "700"].map(
  (weight) => `${weight} 13px "${UI_FONT_FAMILY}"`,
);

/**
 * How long start-up waits for the faces before it goes on without them. They
 * are data URLs in the bundle, so they normally decode in milliseconds; the
 * cap only bounds a broken load.
 */
export const CODE_FONT_WAIT_MS = 1500;

/**
 * How the wait for the code face ended:
 * - `loaded`: it arrived within the cap and everything was re-measured;
 * - `timeout`: the cap came first; the re-measure runs when it arrives;
 * - `missing`: a requested code face matched nothing (the stylesheet is not in the page);
 * - `failed`: the browser could not load it.
 */
export type CodeFontOutcome = "loaded" | "timeout" | "missing" | "failed";

/** The body marker: the outcome, or `late` once a capped wait's faces arrive. */
export type CodeFontMark = CodeFontOutcome | "late";

/** The first family of a CSS font stack, without its quotes. */
export function firstFamily(stack: string): string {
  return families(stack)[0] ?? "";
}

/** Every family of a CSS font stack, in order, without quotes. */
export function families(stack: string): string[] {
  return stack
    .split(",")
    .map((family) => family.trim().replace(/^(['"])(.*)\1$/, "$2"))
    .filter(Boolean);
}

/**
 * Wait for the code face, up to `cap`, and call `remeasure` once it is in.
 *
 * Arrived before the cap: `remeasure(false)` runs before this resolves, so
 * whatever start-up creates next measures the real face. The cap first: this
 * resolves `timeout` at once, and `remeasure(true)` runs when the face does
 * arrive. A load that matched nothing, or failed, re-measures nothing: the
 * fallback face is what was measured, and it is what stays.
 *
 * `load` resolves to one list per requested face, as `document.fonts.load`
 * gives them; that resolves to an empty list, not a rejection, when no
 * declared face matches, so every list must be non-empty to count as loaded.
 */
export async function settleCodeFont(
  load: Promise<readonly (readonly unknown[])[]>,
  cap: Promise<void>,
  remeasure: (late: boolean) => void,
): Promise<CodeFontOutcome> {
  const arrived = load.then(
    (lists): CodeFontOutcome => (lists.length > 0 && lists.every((faces) => faces.length > 0) ? "loaded" : "missing"),
    (): CodeFontOutcome => "failed",
  );
  const outcome = await Promise.race([arrived, cap.then((): CodeFontOutcome => "timeout")]);
  if (outcome === "loaded") remeasure(false);
  else if (outcome === "timeout") {
    void arrived.then((late) => {
      if (late === "loaded") remeasure(true);
    });
  }
  return outcome;
}

/** The two timer calls the gate uses, so a test can stand in for the window's. */
export interface Timers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/** A promise that resolves after `ms`, and the call that stops its timer. */
export function startCap(ms: number, timers: Timers): { readonly promise: Promise<void>; cancel(): void } {
  let id: unknown;
  const promise = new Promise<void>((resolve) => {
    id = timers.setTimeout(resolve, ms);
  });
  return { promise, cancel: () => timers.clearTimeout(id) };
}

/** What the contribution's `onStart` hands the gate. */
export interface CodeFontGate {
  /** The code face's load, as `initialize` started it (one list per requested face). */
  readonly load: Promise<readonly (readonly unknown[])[]>;
  /** The UI face's load, settled whatever happens (`Promise.allSettled`). */
  readonly uiLoad: Promise<unknown>;
  readonly timers: Timers;
  /** Re-measure Monaco and the terminals; `late` when the cap came first. */
  remeasure(late: boolean): void;
  /** Write the body marker. */
  mark(value: CodeFontMark): void;
}

/**
 * The contribution's `onStart`: wait for the code face up to
 * `CODE_FONT_WAIT_MS`, re-measure on arrival, and mark how it went; then
 * give the UI face whatever is left of the same cap. The UI face never
 * changes the outcome: missing, failed or slow, it only ends its own wait.
 * The cap's timer is stopped once both waits are over. A late arrival can
 * be re-measured before the wait's own `timeout` is marked; `late` is the
 * newer news, so it stays.
 */
export async function gateCodeFont(gate: CodeFontGate): Promise<CodeFontOutcome> {
  const cap = startCap(CODE_FONT_WAIT_MS, gate.timers);
  let late = false;
  try {
    const outcome = await settleCodeFont(gate.load, cap.promise, (isLate) => {
      gate.remeasure(isLate);
      if (isLate) {
        late = true;
        gate.mark("late");
      }
    });
    if (!late) gate.mark(outcome);
    await Promise.race([gate.uiLoad.catch(() => undefined), cap.promise]);
    return outcome;
  } finally {
    cap.cancel();
  }
}

/** The slice of an xterm instance a re-measure touches. */
export interface XtermFontLike {
  readonly options: { fontFamily?: string | undefined };
  clearTextureAtlas?(): void;
}

/** Whether `term` looks enough like an xterm instance to re-measure. */
export function isXtermFontLike(term: unknown): term is XtermFontLike {
  if (!term || typeof term !== "object") return false;
  const options = (term as { options?: unknown }).options;
  return !!options && typeof options === "object";
}

/**
 * Make an xterm measure its character box again and redraw its glyphs.
 *
 * xterm measures the box when the terminal opens, and again only when
 * `fontFamily` or `fontSize` changes; its option setter drops a write of the
 * value it already holds. So the family is moved off and back in one task,
 * before anything paints, and the family put back is the one the terminal
 * holds, which keeps a per-family `spexr.terminal.*.fontFamily` in place.
 * Glyphs live in a texture atlas that terminals with the same options share,
 * so one drawn in the fallback face survives the round trip: it is cleared.
 * A terminal not opened yet only has its option written; it measures on open.
 * A hidden one (display: none) cannot measure at all: see remeasureTerminals.
 *
 * Returns false, touching nothing, when the terminal has no family set.
 */
export function remeasureXterm(term: XtermFontLike): boolean {
  const family = term.options.fontFamily;
  if (typeof family !== "string" || !family) return false;
  term.options.fontFamily = "";
  term.options.fontFamily = family;
  term.clearTextureAtlas?.();
  return true;
}

/** What remeasureTerminals needs from one terminal widget. */
export interface TerminalHandle {
  /** The widget's xterm instance, read when it is re-measured. */
  readonly xterm: unknown;
  readonly isVisible: boolean;
  /** Subscribes to the widget's visibility changes; `dispose` stops it. */
  onDidChangeVisibility(listener: (visible: boolean) => void): { dispose(): void };
  /** Has Theia refit the terminal's rows and columns to its box. */
  refit(): void;
}

export interface RemeasureHooks {
  /** Once per terminal actually re-measured: now, or when a hidden one is next shown. */
  remeasured(): void;
  /** What a terminal threw; the others go on regardless. */
  failed(err: unknown): void;
}

/**
 * Re-measure every terminal, each on its own, so one that throws does not
 * stop the rest.
 *
 * A visible terminal is re-measured and refitted now. A hidden one is
 * `display: none`, where xterm's measure reads zero and keeps the box it had,
 * and showing it later refits to that same stale box; so it is left alone
 * until it is next shown, then re-measured and refitted once. Returns how
 * many were deferred that way.
 */
export function remeasureTerminals(terminals: Iterable<TerminalHandle>, hooks: RemeasureHooks): number {
  const run = (terminal: TerminalHandle): void => {
    try {
      const xterm = terminal.xterm;
      if (!isXtermFontLike(xterm) || !remeasureXterm(xterm)) return;
      terminal.refit();
      hooks.remeasured();
    } catch (err) {
      hooks.failed(err);
    }
  };
  let deferred = 0;
  for (const terminal of terminals) {
    try {
      if (!isXtermFontLike(terminal.xterm)) continue;
      if (terminal.isVisible) {
        run(terminal);
        continue;
      }
      let done = false;
      let subscription: { dispose(): void } | undefined;
      subscription = terminal.onDidChangeVisibility((visible) => {
        if (!visible || done) return;
        done = true;
        subscription?.dispose();
        run(terminal);
      });
      if (done) subscription.dispose();
      deferred++;
    } catch (err) {
      hooks.failed(err);
    }
  }
  return deferred;
}
