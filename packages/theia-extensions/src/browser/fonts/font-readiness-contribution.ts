import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { Widget } from "@theia/core/lib/browser/widgets/widget";
import { MessageLoop } from "@theia/core/shared/@lumino/messaging";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import * as monaco from "@theia/monaco-editor-core";
import {
  CODE_FONT_LOADS,
  UI_FONT_LOADS,
  gateCodeFont,
  remeasureTerminals,
  type CodeFontMark,
  type TerminalHandle,
} from "./code-font.js";

/**
 * Holds start-up until the code face (Geist Mono) is in, then has Monaco and
 * every terminal measure it again. The UI face (Geist) gets the rest of the
 * same wait, best effort, and never changes the outcome.
 *
 * Monaco and xterm measure the character box once and keep it: Monaco caches
 * it per font until told to forget, xterm until its font option changes.
 * Measured before the face loads, they keep the fallback's box, and text
 * overlaps or gaps. Theia awaits every contribution's `onStart` before it
 * builds the layout, and the layout is what opens editors and terminals (the
 * Claude terminal opens in the bootstrap's `onDidInitializeLayout`), so
 * waiting here means they measure the real face. The wait is capped; past
 * it, start-up goes on and the re-measure runs when the faces arrive. The
 * logic is in code-font.ts; this class only wires it to Theia.
 *
 * Two body attributes say how it went, for the screenshot workflow's probe:
 * `data-spexr-code-font` is the outcome (`late` once a capped wait's faces
 * arrive), and `data-spexr-code-font-terminals` counts the terminals
 * actually re-measured, including a hidden one when it is next shown; 0 on
 * the normal path means no terminal had measured the fallback.
 */
@injectable()
export class SpexrFontReadinessContribution implements FrontendApplicationContribution {
  @inject(TerminalService) private readonly terminals!: TerminalService;

  private loading: Promise<readonly (readonly unknown[])[]> = Promise.resolve([]);
  private uiLoading: Promise<unknown> = Promise.resolve();
  private remeasured = 0;

  /** Starts the loads: `initialize` runs before any contribution's `onStart`. */
  initialize(): void {
    this.loading = loadFaces(CODE_FONT_LOADS);
    // Settled through gateCodeFont in onStart; this only keeps a rejection
    // before then from being reported as unhandled.
    this.loading.catch(() => undefined);
    this.uiLoading = Promise.allSettled([loadFaces(UI_FONT_LOADS)]);
  }

  async onStart(): Promise<void> {
    await gateCodeFont({
      load: this.loading,
      uiLoad: this.uiLoading,
      timers: window,
      remeasure: () => this.remeasure(),
      mark: (value) => setBodyData("spexrCodeFont", value),
    });
  }

  /** Monaco forgets every cached measurement; each terminal measures again and refits. */
  private remeasure(): void {
    try {
      monaco.editor.remeasureFonts();
    } catch (err) {
      console.warn("[spexr] could not re-measure the editor font", err);
    }
    setBodyData("spexrCodeFontTerminals", String(this.remeasured));
    remeasureTerminals(this.terminals.all.map(handle), {
      remeasured: () => setBodyData("spexrCodeFontTerminals", String(++this.remeasured)),
      failed: (err) => console.warn("[spexr] could not re-measure a terminal's font", err),
    });
  }
}

/**
 * A terminal widget as remeasureTerminals sees it. The xterm lives in the
 * widget's protected `term` field, as for the style contribution; the access
 * is guarded there, so a Theia that moves it costs the re-measure, not
 * start-up. A resize message is how Theia itself makes a terminal refit.
 */
function handle(widget: TerminalWidget): TerminalHandle {
  return {
    get xterm() {
      return (widget as unknown as { term?: unknown }).term;
    },
    get isVisible() {
      return widget.isVisible;
    },
    onDidChangeVisibility: (listener) => widget.onDidChangeVisibility(listener),
    refit: () => MessageLoop.sendMessage(widget, Widget.ResizeMessage.UnknownSize),
  };
}

/** Asks for each face; one empty list when the page has no font API. */
function loadFaces(faces: readonly string[]): Promise<readonly (readonly unknown[])[]> {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== "function") return Promise.resolve([[]]);
  return Promise.all(faces.map((face) => fonts.load(face)));
}

function setBodyData(key: "spexrCodeFont" | "spexrCodeFontTerminals", value: CodeFontMark | string): void {
  try {
    document.body.dataset[key] = value;
  } catch {
    /* no body yet: the probe reads nothing, start-up is unaffected */
  }
}
