/**
 * The code face: Geist Mono in the editor and the terminal (owner, 2026-10-05,
 * reversing JetBrains Mono from 2026-10-02). One stack for both, held here so
 * a test can keep `apps/desktop/package.json`'s preference defaults on it.
 * Geist Mono is bundled (the kit's fonts.css, inlined by the build); the rest
 * of the stack only serves a glyph the face lacks.
 */
export const CODE_FONT_STACK = "'Geist Mono', 'SF Mono', Menlo, Consolas, monospace";

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

/**
 * What `document.fonts.load` is asked for: the regular and bold the editor and
 * terminal draw. The bundled face is one variable file, so either load brings
 * in both; asking for each keeps that true if the kit ever splits the file.
 */
export const CODE_FONT_LOADS: readonly string[] = [
  `400 13px "${CODE_FONT_FAMILY}"`,
  `700 13px "${CODE_FONT_FAMILY}"`,
];

/**
 * How long start-up waits for the face before it goes on without it. The face
 * is a data URL in the bundle, so it normally decodes in milliseconds; the cap
 * only bounds a broken load.
 */
export const CODE_FONT_WAIT_MS = 1500;

/**
 * How the wait ended:
 * - `loaded`: the face arrived within the cap and everything was re-measured;
 * - `timeout`: the cap came first; the re-measure runs when the face arrives;
 * - `missing`: no declared face matched (the stylesheet is not in the page);
 * - `failed`: the browser could not load the face.
 */
export type CodeFontOutcome = "loaded" | "timeout" | "missing" | "failed";

/** The first family of a CSS font stack, without its quotes. */
export function firstFamily(stack: string): string {
  return (stack.split(",")[0] ?? "").trim().replace(/^(['"])(.*)\1$/, "$2");
}

/**
 * Wait for the code face, up to `cap`, and call `remeasure` once it is in.
 *
 * Arrived before the cap: `remeasure(false)` runs before this resolves, so
 * whatever start-up creates next measures the real face. The cap first: this
 * resolves `timeout` at once, and `remeasure(true)` runs when the face does
 * arrive. A load that matched no face, or failed, re-measures nothing: the
 * fallback face is what was measured, and it is what stays.
 *
 * `load` resolves to the faces it loaded, as `document.fonts.load` does; that
 * resolves to an empty list, not a rejection, when no face matches.
 */
export async function settleCodeFont(
  load: Promise<readonly unknown[]>,
  cap: Promise<void>,
  remeasure: (late: boolean) => void,
): Promise<CodeFontOutcome> {
  const arrived = load.then(
    (faces): CodeFontOutcome => (faces.length > 0 ? "loaded" : "missing"),
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
