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
/** A resize is acted on after the width has held still this long: dragging a sash is many resizes. */
export const RELAY_MS = 120;

interface Drawn {
  deco: XtermDecoration;
  readonly block: FinishedBlock<XtermMarker>;
  /** Where the block's output ended: it follows the buffer's reflow, so the frame's height can be read from it again. */
  readonly end: XtermMarker | undefined;
  /** 1 when the output left the cursor on its last line (no trailing newline), else 0. */
  readonly extra: number;
  framed: boolean;
}

/** The timers the controller uses; injected so a test moves time itself. */
export interface BlockTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const REAL_TIMERS: BlockTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export interface BlockStats {
  prompts: number;
  started: number;
  finished: number;
  rejected: number;
  drawn: number;
}

/**
 * The command blocks of one terminal (S6l): reads spexr's OSC 133 marks (the
 * shell's own, authenticated by the nonce the backend gave it: command-blocks.ts)
 * and lays an element over each command's lines with xterm's decorations, a
 * frame and a chip with the time, the duration and the exit code. A running
 * command gets the chip alone, on its prompt line.
 *
 * - It must run before Theia's handler for the same OSC number (xterm calls
 *   the last registered first), and {@link hook} registers it again when Theia
 *   re-registers its own. It returns false for Theia's marks, which Theia still
 *   needs and which move no block here, and true for spexr's, which nothing
 *   else is to see.
 * - Until {@link setNonce} gives it the shell's nonce it believes nothing.
 * - A narrower or wider terminal reflows its lines, so a frame's width and
 *   height are no longer true. The markers follow the reflow, so once the width
 *   has held still (RELAY_MS) each frame, and the running chip, is laid again
 *   from the prompt marker to a marker at the end of its output. Where a marker
 *   is gone or the height does not come out, the command keeps the chip alone
 *   (the meta-only fallback), which does not depend on a height.
 * - Every marker it makes is let go with the block it belongs to: when the
 *   block is evicted past {@link MAX_BLOCKS}, and on dispose.
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
  private relayHandle: unknown;
  /** How many of each mark were met, for a support question ("why no blocks?") and the visual run's diagnosis. */
  readonly stats: BlockStats = { prompts: 0, started: 0, finished: 0, rejected: 0, drawn: 0 };

  constructor(
    private readonly term: XtermLike,
    private readonly onChange: () => void = () => undefined,
    private readonly timers: BlockTimers = REAL_TIMERS,
  ) {
    this.lastCols = term.cols;
    this.resize = term.onResize(({ cols }) => {
      if (cols === this.lastCols) return;
      this.lastCols = cols;
      if (this.relayHandle !== undefined) this.timers.clear(this.relayHandle);
      this.relayHandle = this.timers.set(() => {
        this.relayHandle = undefined;
        this.relayFrames();
      }, RELAY_MS);
    });
    this.hook();
  }

  /** The shell's nonce, from the backend (undefined: believe nothing). */
  setNonce(nonce: string | undefined): void {
    this.tracker.setNonce(nonce);
  }

  /** Register the OSC handler, in front of every one registered so far. */
  hook(): void {
    this.handler?.dispose();
    this.handler = this.term.parser.registerOscHandler(OSC_COMMAND_MARKS, (payload) => this.onMark(payload));
  }

  dispose(): void {
    if (this.relayHandle !== undefined) this.timers.clear(this.relayHandle);
    this.relayHandle = undefined;
    this.handler?.dispose();
    this.resize.dispose();
    this.running?.dispose();
    const run = this.tracker.running;
    if (run?.prompt && !this.drawn.some((d) => d.block.prompt === run.prompt)) run.prompt.dispose();
    for (const d of this.drawn) this.release(d);
    this.drawn = [];
    this.idlePrompt?.dispose();
  }

  /** How many blocks are drawn (framed or as a chip only). */
  get count(): number {
    return this.drawn.length;
  }

  private onMark(payload: string): boolean {
    // Theia's own marks pass: it needs them, and here they are unauthenticated, so they move no block.
    if (!isSpexrPayload(payload)) return false;
    const mark = this.tracker.accept(payload);
    if (!mark) {
      this.stats.rejected++;
      this.onChange();
      return true;
    }
    if (mark.kind === "prompt") {
      this.stats.prompts++;
      const marker = this.term.registerMarker(0);
      if (marker) {
        this.idlePrompt?.dispose();
        this.idlePrompt = marker;
        this.tracker.promptStarted(marker);
      }
    } else if (mark.kind === "started") {
      this.stats.started++;
      this.abandonRunning();
      const run = this.tracker.commandStarted(mark.epochMs);
      // The prompt's marker now belongs to this command's decorations.
      if (run.prompt === this.idlePrompt) this.idlePrompt = undefined;
      this.drawRunning(run.prompt);
    } else {
      const { baseY, cursorY, cursorX } = this.term.buffer.active;
      const block = this.tracker.finish(mark, baseY + cursorY, cursorX);
      if (block) {
        this.stats.finished++;
        this.drawFinished(block);
      } else {
        this.stats.rejected++;
      }
    }
    this.onChange();
    return true;
  }

  /** A command that never reported its end (its mark was lost): its chip and marker are let go. */
  private abandonRunning(): void {
    const run = this.tracker.running;
    this.running?.dispose();
    this.running = undefined;
    if (run?.prompt && !this.drawn.some((d) => d.block.prompt === run.prompt)) run.prompt.dispose();
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
    if (!marker || marker.isDisposed || marker.line < 0 || block.lines < 1) {
      marker?.dispose();
      return;
    }
    const deco = this.term.registerDecoration({ marker, x: 0, width: this.term.cols, height: block.lines, layer: "top" });
    if (!deco) {
      marker.dispose();
      return;
    }
    this.fill(deco, finishedMeta(block), true);
    this.stats.drawn++;
    const end = this.term.registerMarker(0);
    const extra = end ? Math.max(0, block.lines - (end.line - marker.line)) : 0;
    this.drawn.push({ deco, block, end, extra, framed: true });
    while (this.drawn.length > MAX_BLOCKS) {
      const old = this.drawn.shift();
      if (old) this.release(old);
    }
  }

  /** Let go of a block's decoration and both of its markers. */
  private release(d: Drawn): void {
    d.deco.dispose();
    d.end?.dispose();
    d.block.prompt?.dispose();
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

  /** After the width has held still: each frame again, as high as its lines now are; the chip alone where that cannot be read. */
  private relayFrames(): void {
    for (const d of this.drawn) {
      d.deco.dispose();
      const start = d.block.prompt;
      const alive = start && !start.isDisposed && start.line >= 0;
      const height = alive && d.end && !d.end.isDisposed && d.end.line >= start.line ? d.end.line - start.line + d.extra : 0;
      const framed = height >= 1;
      const deco = alive ? this.term.registerDecoration({ marker: start, x: 0, width: this.term.cols, height: framed ? height : 1, layer: "top" }) : undefined;
      d.framed = framed;
      if (deco) {
        this.fill(deco, finishedMeta(d.block), framed);
        d.deco = deco;
      }
    }
    // The running command's chip spans the width too.
    const run = this.tracker.running;
    if (this.running && run) this.drawRunning(run.prompt);
  }
}
