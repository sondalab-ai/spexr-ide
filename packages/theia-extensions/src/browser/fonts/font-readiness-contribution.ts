import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { Widget } from "@theia/core/lib/browser/widgets/widget";
import { MessageLoop } from "@theia/core/shared/@lumino/messaging";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import * as monaco from "@theia/monaco-editor-core";
import {
  CODE_FONT_LOADS,
  CODE_FONT_WAIT_MS,
  isXtermFontLike,
  remeasureXterm,
  settleCodeFont,
  type CodeFontOutcome,
} from "./code-font.js";

/**
 * Holds start-up until the code face (Geist Mono) is in, then has Monaco and
 * every open terminal measure it again.
 *
 * Both measure the character box once and keep it: Monaco caches it per font
 * until told to forget, xterm until its font option changes. Measured before
 * the face loads, they keep the fallback's box, and text overlaps or gaps.
 * Theia awaits every contribution's `onStart` before it builds the layout,
 * and the layout is what opens editors and terminals (the Claude terminal
 * opens in the bootstrap's `onDidInitializeLayout`), so waiting here means
 * they measure the real face. The wait is capped (`CODE_FONT_WAIT_MS`); past
 * it, start-up goes on and the re-measure runs when the face arrives.
 *
 * Two body attributes say how it went, for the screenshot workflow's probe:
 * `data-spexr-code-font` is the outcome (`late` once a capped wait's face
 * arrives), and `data-spexr-code-font-terminals` counts the terminals that
 * already existed when the face was re-measured; 0 means none had measured
 * the fallback.
 */
@injectable()
export class SpexrFontReadinessContribution implements FrontendApplicationContribution {
  @inject(TerminalService) private readonly terminals!: TerminalService;

  private loading: Promise<readonly unknown[]> = Promise.resolve([]);

  /** Starts the load: `initialize` runs before any contribution's `onStart`. */
  initialize(): void {
    this.loading = loadCodeFont();
  }

  async onStart(): Promise<void> {
    const outcome = await settleCodeFont(this.loading, delay(CODE_FONT_WAIT_MS), (late) => this.remeasure(late));
    // A face that lands just after the cap can be re-measured before this
    // line runs; its "late" is the newer news.
    if (document.body.dataset.spexrCodeFont !== "late") mark(outcome);
  }

  /** Monaco forgets every cached measurement; each terminal measures again and refits. */
  private remeasure(late: boolean): void {
    try {
      monaco.editor.remeasureFonts();
    } catch (err) {
      console.warn("[spexr] could not re-measure the editor font", err);
    }
    let terminals = 0;
    for (const widget of this.terminals.all) {
      if (this.remeasureTerminal(widget)) terminals++;
    }
    document.body.dataset.spexrCodeFontTerminals = String(terminals);
    if (late) mark("late");
  }

  /**
   * The xterm lives in the widget's protected `term` field, as for the style
   * contribution; the access is guarded, so a Theia that moves it costs the
   * re-measure, not start-up. The box changed, so the rows and columns that
   * fit did too: a resize message makes Theia refit, and a hidden terminal
   * keeps it pending until it is shown.
   */
  private remeasureTerminal(widget: TerminalWidget): boolean {
    const term = (widget as unknown as { term?: unknown }).term;
    if (!isXtermFontLike(term)) return false;
    try {
      if (!remeasureXterm(term)) return false;
      MessageLoop.sendMessage(widget, Widget.ResizeMessage.UnknownSize);
      return true;
    } catch (err) {
      console.warn("[spexr] could not re-measure a terminal's font", err);
      return false;
    }
  }
}

/** Asks for every face the editor and terminal draw; an empty list when the page has no font API. */
function loadCodeFont(): Promise<readonly unknown[]> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve([]);
  return Promise.all(CODE_FONT_LOADS.map((face) => fonts.load(face))).then((loaded) => loaded.flat());
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mark(outcome: CodeFontOutcome | "late"): void {
  document.body.dataset.spexrCodeFont = outcome;
}
