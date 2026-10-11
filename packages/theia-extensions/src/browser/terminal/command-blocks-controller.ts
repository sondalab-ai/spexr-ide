import { BlockTracker, OSC_COMMAND_MARKS, RUNNING_META, buildBlockElement, finishedMeta, isSpexrPayload, type DomElement, type FinishedBlock, type LineMarker } from "./command-blocks.js";

/** The slice of xterm's marker the blocks use. */
export interface XtermMarker extends LineMarker {
  readonly isDisposed: boolean;
  dispose(): void;
}

/** The slice of xterm's decoration the blocks use: the element xterm lays over the marker's lines is handed to `onRender`. */
export interface XtermDecoration {
  readonly isDisposed: boolean;
  dispose(): void;
  onRender(listener: (element: BlockHost) => void): { dispose(): void };
}

/** The element xterm gives a decoration, as far as the blocks touch it. */
export interface BlockHost extends DomElement {
  readonly ownerDocument: { createElement(tag: string): DomElement };
}

/** The slice of an xterm instance the blocks need, so they are driven (and tested) without one. */
export interface XtermLike {
  readonly cols: number;
  readonly buffer: { readonly active: { readonly baseY: number; readonly cursorY: number; readonly cursorX: number } };
  readonly parser: { registerOscHandler(ident: number, handler: (data: string) => boolean | Promise<boolean>): { dispose(): void } };
  registerMarker(cursorYOffset?: number): XtermMarker | undefined;
  registerDecoration(options: { marker: XtermMarker; x?: number; width?: number; height?: number; layer?: "bottom" | "top" }): XtermDecoration | undefined;
  onResize(listener: (size: { cols: number; rows: number }) => void): { dispose(): void };
}

/** The most blocks kept per terminal: the oldest is let go past it. */
export const MAX_BLOCKS = 200;

interface Drawn {
  deco: XtermDecoration;
  readonly block: FinishedBlock<XtermMarker>;
  framed: boolean;
}

/**
 * The command blocks of one terminal (S6l): reads Theia's OSC 133 marks and
 * spexr's own beside them, and lays an element over each command's lines with
 * xterm's decorations, a frame and a chip with the time, the duration and the
 * exit code. A running command gets the chip alone, on its prompt line.
 *
 * - It must run before Theia's handler for the same OSC number (xterm calls
 *   the last registered first), and {@link hook} registers it again when Theia
 *   re-registers its own. It returns false for Theia's marks, which Theia still
 *   needs, and true for spexr's own, which nothing else is to see.
 * - A narrower or wider terminal reflows its lines, so the frames' heights are
 *   no longer true: on a change of columns each frame is let go and its
 *   command keeps the chip (the meta-only fallback), which does not depend on a
 *   height.
 */
export class TerminalBlocks {
  private readonly tracker = new BlockTracker<XtermMarker>();
  private handler: { dispose(): void } | undefined;
  private readonly resize: { dispose(): void };
  private drawn: Drawn[] = [];
  private running: XtermDecoration | undefined;
  /** The prompt marker no command has used yet: let go when the next prompt replaces it. */
  private idlePrompt: XtermMarker | undefined;
  private lastCols: number;

  constructor(
    private readonly term: XtermLike,
    private readonly now: () => number = Date.now,
  ) {
    this.lastCols = term.cols;
    this.resize = term.onResize(({ cols }) => {
      if (cols === this.lastCols) return;
      this.lastCols = cols;
      this.collapseFrames();
    });
    this.hook();
  }

  /** Register the OSC handler, in front of every one registered so far. */
  hook(): void {
    this.handler?.dispose();
    this.handler = this.term.parser.registerOscHandler(OSC_COMMAND_MARKS, (payload) => this.onMark(payload));
  }

  dispose(): void {
    this.handler?.dispose();
    this.resize.dispose();
    this.running?.dispose();
    for (const d of this.drawn) d.deco.dispose();
    this.drawn = [];
    this.idlePrompt?.dispose();
  }

  /** How many blocks are drawn (framed or as a chip only). */
  get count(): number {
    return this.drawn.length;
  }

  private onMark(payload: string): boolean {
    if (payload === "prompt_started") {
      const marker = this.term.registerMarker(0);
      if (marker) {
        this.idlePrompt?.dispose();
        this.idlePrompt = marker;
        this.tracker.promptStarted(marker);
      }
      return false;
    }
    if (payload.startsWith("command_started")) {
      const run = this.tracker.commandStarted(this.now());
      // The prompt's marker now belongs to this command's decorations.
      if (run.prompt === this.idlePrompt) this.idlePrompt = undefined;
      this.drawRunning(run.prompt);
      return false;
    }
    if (!isSpexrPayload(payload)) return false;
    const { baseY, cursorY, cursorX } = this.term.buffer.active;
    const result = this.tracker.mark(payload, baseY + cursorY, cursorX);
    if (result?.kind === "finished") this.drawFinished(result.block);
    // Whatever begins with `spexr_`, believed or not, is not Theia's to see.
    return true;
  }

  private drawRunning(prompt: XtermMarker | undefined): void {
    this.running?.dispose();
    this.running = undefined;
    if (!prompt || prompt.isDisposed || prompt.line < 0) return;
    const deco = this.term.registerDecoration({ marker: prompt, x: 0, width: this.term.cols, height: 1, layer: "top" });
    if (!deco) return;
    this.fill(deco, RUNNING_META, false);
    this.running = deco;
  }

  private drawFinished(block: FinishedBlock<XtermMarker>): void {
    this.running?.dispose();
    this.running = undefined;
    const marker = block.prompt;
    if (!marker || marker.isDisposed || marker.line < 0 || block.lines < 1) return;
    const deco = this.term.registerDecoration({ marker, x: 0, width: this.term.cols, height: block.lines, layer: "top" });
    if (!deco) return;
    this.fill(deco, finishedMeta(block), true);
    this.drawn.push({ deco, block, framed: true });
    while (this.drawn.length > MAX_BLOCKS) this.drawn.shift()?.deco.dispose();
  }

  /** Put the element in the decoration once xterm has made it, and not again however often it renders. */
  private fill(deco: XtermDecoration, meta: Parameters<typeof buildBlockElement>[1], framed: boolean): void {
    const filled = new WeakSet<object>();
    deco.onRender((host) => {
      if (filled.has(host)) return;
      filled.add(host);
      host.appendChild(buildBlockElement(host.ownerDocument, meta, framed));
    });
  }

  private collapseFrames(): void {
    for (const d of this.drawn) {
      if (!d.framed) continue;
      d.framed = false;
      d.deco.dispose();
      const marker = d.block.prompt;
      const deco = marker && !marker.isDisposed && marker.line >= 0 ? this.term.registerDecoration({ marker, x: 0, width: this.term.cols, height: 1, layer: "top" }) : undefined;
      if (deco) {
        this.fill(deco, finishedMeta(d.block), false);
        d.deco = deco;
      }
    }
  }
}
