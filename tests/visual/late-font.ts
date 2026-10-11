import type { Page } from "@playwright/test";
import { runCommand, waitForAck } from "./scenes";

/** Dispatched on the page's window to let the held Geist Mono loads go. */
const RELEASE_EVENT = "spexr:release-code-font";

/**
 * Installed with `page.addInitScript`, so it runs in every document from the
 * reload on, before any of spexr's scripts: `document.fonts.load` for Geist
 * Mono waits until the window receives `event`, and counts how often it was
 * asked. Nothing in spexr knows about it; spexr's own wait for the code face
 * (packages/theia-extensions/src/browser/fonts/code-font.ts) simply meets its
 * real cap. The UI face, Geist, is not held.
 */
function holdCodeFace(event: string): void {
  const fonts = document.fonts;
  const load = fonts.load.bind(fonts);
  const page = window as unknown as { __spexrVisualHeldLoads?: number };
  page.__spexrVisualHeldLoads = 0;
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  window.addEventListener(event, () => release(), { once: true });
  fonts.load = (font: string, text?: string) => {
    if (!font.includes("Geist Mono")) return load(font, text);
    page.__spexrVisualHeldLoads = (page.__spexrVisualHeldLoads ?? 0) + 1;
    return released.then(() => load(font, text));
  };
}

/** One xterm in the page: opened (it has a screen) and whether it is laid out. */
export interface XtermState {
  readonly visible: boolean;
  readonly where: string;
}

/** The visible bottom terminal's font as xterm resolves it. */
export interface TerminalCell {
  readonly box: { readonly width: number; readonly height: number } | null;
  readonly cell: { readonly width: number; readonly height: number } | null;
  readonly screenHeight: number | null;
  readonly rows: number | null;
}

/**
 * The late-font scene's record. The marker and the count are spexr's body
 * attributes (`data-spexr-code-font`, `data-spexr-code-font-terminals`).
 */
export interface LateFontResult {
  /** Geist Mono loads the init script held after the reload: spexr asks for 400 and 700; 0 means it never ran. */
  readonly heldLoads: number | null;
  /** The marker after the held reload: `timeout`, spexr's real 1.5s cap having passed. */
  readonly heldMark: string | null;
  /** Whether Geist Mono was already loaded when the faces were released: the page uses it on its own. */
  readonly faceLoadedBeforeRelease: boolean;
  /** Every opened xterm just before the release. */
  readonly beforeRelease: readonly XtermState[];
  /** The marker after the release: `late`. */
  readonly lateMark: string | null;
  /** Terminals re-measured at the release: the visible ones. */
  readonly remeasuredAtRelease: number | null;
  /** The count once late-a, hidden at the release, is shown again: one more, unless something else was shown meanwhile. */
  readonly remeasuredAfterShow: number | null;
  /** late-a's cell once shown and re-measured. */
  readonly shown: TerminalCell | null;
  /** What did not hold; empty when the late path behaved. */
  readonly problems: readonly string[];
}

/**
 * The capped path, end to end, in the running app.
 *
 * Reload with Geist Mono's loads held by an init script, so spexr's wait
 * meets its real 1.5s cap and start-up goes on without the face (`timeout`). Open terminal late-a, then late-b over it, so late-a is an
 * opened terminal hidden behind another. Release the faces: spexr marks
 * `late` and re-measures the visible terminals now, leaving late-a for
 * later. Show late-a: it is re-measured then, one more in the count, and its
 * cell must be the one the normal path measured in the base scene.
 *
 * The page uses Geist Mono on its own (the editor asks for it), so by the
 * release the face is usually in already, and these re-measures change no
 * box: this proves the late path runs and lands on the right cell, not that
 * it repairs a fallback measurement. `faceLoadedBeforeRelease` records which.
 */
export async function lateFontScene(
  page: Page,
  ackDir: string,
  expectedCell: { readonly width: number; readonly height: number } | null,
): Promise<LateFontResult> {
  const problems: string[] = [];
  await page.addInitScript(holdCodeFace, RELEASE_EVENT);
  await page.reload();
  await page.waitForSelector("body[data-spexr-layout-ready]", { timeout: 120_000 });
  await page.waitForFunction(() => !!document.body.dataset.spexrCodeFont, undefined, { timeout: 30_000 });
  const heldLoads = await page.evaluate(() => (window as unknown as { __spexrVisualHeldLoads?: number }).__spexrVisualHeldLoads ?? null);
  if (!heldLoads) problems.push(`the init script held ${heldLoads} Geist Mono loads after the reload: it did not run, or spexr asked for none`);
  const heldMark = await mark(page);
  if (heldMark !== "timeout") problems.push(`held reload marked ${heldMark}, not timeout`);
  // The commands are declared `onCommand:`, so each one activates the
  // fixture extension after the reload if it has to; its ack is the wait.
  // late-a must open (xterm measures on open) before late-b covers it, or
  // it would only be the never-opened case: an opened xterm has a screen.
  const openedBefore = (await xterms(page)).length;
  await runCommand(page, "Parity: Late font: open terminal A");
  await waitForAck(ackDir, "lateOpenA");
  await page
    .waitForFunction((n) => [...document.querySelectorAll(".xterm")].filter((x) => x.querySelector(".xterm-screen")).length > n, openedBefore, { timeout: 30_000 })
    .catch(() => undefined);
  const afterA = await xterms(page);
  if (afterA.length <= openedBefore) problems.push("late-a never opened before late-b covered it");
  const hiddenAfterA = afterA.filter((x) => !x.visible).length;

  await runCommand(page, "Parity: Late font: open terminal B");
  await waitForAck(ackDir, "lateOpenB");
  await page
    .waitForFunction(
      (n) => [...document.querySelectorAll(".xterm")].filter((x) => x.querySelector(".xterm-screen") && x.getBoundingClientRect().width === 0).length > n,
      hiddenAfterA,
      { timeout: 30_000 },
    )
    .catch(() => undefined);
  const beforeRelease = await xterms(page);
  if (beforeRelease.filter((x) => !x.visible).length <= hiddenAfterA) problems.push("late-b did not hide the opened late-a");
  const faceLoadedBeforeRelease = await page.evaluate(() => document.fonts.check('12.5px "Geist Mono"'));

  await page.evaluate((event) => window.dispatchEvent(new Event(event)), RELEASE_EVENT);
  await page.waitForFunction(() => document.body.dataset.spexrCodeFont === "late", undefined, { timeout: 30_000 }).catch(() => undefined);
  const lateMark = await mark(page);
  if (lateMark !== "late") problems.push(`released faces marked ${lateMark}, not late`);
  const remeasuredAtRelease = await count(page);
  if (!(remeasuredAtRelease !== null && remeasuredAtRelease >= 1)) problems.push(`re-measured ${remeasuredAtRelease} terminals at the release, not at least 1`);

  await runCommand(page, "Parity: Late font: show terminal A");
  await waitForAck(ackDir, "lateShowA");
  await page
    .waitForFunction((before) => Number(document.body.dataset.spexrCodeFontTerminals) > before, remeasuredAtRelease ?? 0, { timeout: 15_000 })
    .catch(() => undefined);
  const remeasuredAfterShow = await count(page);
  if (remeasuredAfterShow === null || remeasuredAfterShow <= (remeasuredAtRelease ?? 0)) {
    problems.push(`showing hidden late-a left the count at ${remeasuredAfterShow} (was ${remeasuredAtRelease})`);
  }
  // `true` ran in late-a: its new prompt moves the cursor a row down, which
  // is when xterm sizes the helper textarea to the cell it now draws.
  await page
    .waitForFunction(() => {
      const t = [...document.querySelectorAll<HTMLElement>("#theia-bottom-content-panel .xterm")].find((x) => x.getBoundingClientRect().width > 0)?.querySelector<HTMLElement>(".xterm-helper-textarea");
      return !!t && parseFloat(t.style.top) > 0;
    }, undefined, { timeout: 15_000 })
    .catch(() => undefined);
  const shown = await shownCell(page);
  if (!shown?.cell || !expectedCell || shown.cell.width !== expectedCell.width || shown.cell.height !== expectedCell.height) {
    problems.push(`late-a's cell is ${cellText(shown?.cell)}, not the base scene's ${cellText(expectedCell)}`);
  }
  if (shown?.rows !== null && shown?.rows !== undefined && !Number.isInteger(shown.rows)) {
    problems.push(`late-a's screen is ${shown.rows} cells tall, not a whole number`);
  }

  return { heldLoads, heldMark, faceLoadedBeforeRelease, beforeRelease, lateMark, remeasuredAtRelease, remeasuredAfterShow, shown, problems };
}

function cellText(cell: { readonly width: number; readonly height: number } | null | undefined): string {
  return cell ? `${cell.width}×${cell.height}` : "unreadable";
}

async function mark(page: Page): Promise<string | null> {
  return page.evaluate(() => document.body.dataset.spexrCodeFont ?? null);
}

async function count(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const n = document.body.dataset.spexrCodeFontTerminals;
    return n === undefined ? null : Number(n);
  });
}

async function xterms(page: Page): Promise<XtermState[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".xterm")]
      .filter((x) => x.querySelector(".xterm-screen"))
      .map((x) => ({
        visible: x.getBoundingClientRect().width > 0,
        where: x.closest("#theia-bottom-content-panel") ? "bottom" : x.closest("#theia-left-content-panel") ? "left" : "main",
      })),
  );
}

async function shownCell(page: Page): Promise<TerminalCell | null> {
  return page.evaluate(() => {
    const term = [...document.querySelectorAll<HTMLElement>("#theia-bottom-content-panel .xterm")].find((x) => x.getBoundingClientRect().width > 0);
    if (!term) return null;
    const measure = term.querySelector<HTMLElement>(".xterm-char-measure-element");
    const textarea = term.querySelector<HTMLElement>(".xterm-helper-textarea");
    const screen = term.querySelector<HTMLElement>(".xterm-screen");
    const len = measure?.textContent?.length ?? 0;
    const px = (v: string | undefined): number | null => (v && Number.isFinite(parseFloat(v)) ? parseFloat(v) : null);
    const cellW = px(textarea?.style.width);
    const cellH = px(textarea?.style.height);
    const screenHeight = px(screen?.style.height);
    return {
      box: measure && len ? { width: Math.round((measure.offsetWidth / len) * 1000) / 1000, height: measure.offsetHeight } : null,
      cell: cellW !== null && cellH !== null ? { width: cellW, height: cellH } : null,
      screenHeight,
      rows: screenHeight !== null && cellH ? Math.round((screenHeight / cellH) * 1000) / 1000 : null,
    };
  });
}
