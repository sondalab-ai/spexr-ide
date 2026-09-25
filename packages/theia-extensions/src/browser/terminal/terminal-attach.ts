/**
 * The DOM operations {@link attachWidget}/{@link detachWidget} need: Lumino's
 * attach and strict detach, and `park`, which puts a widget's node back into
 * the document so a strict detach will accept it.
 */
export interface AttachOps<W, H> {
  attach(widget: W, host: H): void;
  detach(widget: W): void;
  park(widget: W): void;
}

interface Attachable {
  readonly isAttached: boolean;
  readonly node: { readonly isConnected: boolean };
}

/**
 * Detach a widget so Lumino and Theia both see it as detached, even when its
 * node was already taken out of the document by someone else (React removing a
 * card, or the Darkfactory view itself being closed). A strict detach refuses
 * such a node and leaves the widget flagged attached, and Theia's terminal then
 * throws "Widget is already attached." the next time it is mounted. Parking the
 * node first lets the detach run normally, including Theia's own
 * `onBeforeDetach` that releases the terminal's search box.
 */
export function detachWidget<W extends Attachable, H>(widget: W, ops: AttachOps<W, H>): void {
  if (!widget.isAttached) return;
  if (!widget.node.isConnected) ops.park(widget);
  ops.detach(widget);
}

/** Attach a widget into `host`, first clearing any attachment it was left with. */
export function attachWidget<W extends Attachable, H>(widget: W, host: H, ops: AttachOps<W, H>): void {
  detachWidget(widget, ops);
  ops.attach(widget, host);
}

interface ContextLossSource {
  onContextLoss(listener: () => void): { dispose(): void };
  dispose(): void;
}

/**
 * When the terminal's WebGL context is lost and not restored (GPU reset,
 * display change, too many contexts), drop the WebGL renderer so xterm falls
 * back to its DOM renderer. Left alone, the canvas stays black or garbled for
 * the life of the widget, and reopening the card reuses that same widget.
 * Reads Theia's protected `webglAddon` field; absent, this is a no-op.
 */
export function fallBackOnContextLoss(terminal: object): { dispose(): void } | undefined {
  const addon = (terminal as { webglAddon?: ContextLossSource }).webglAddon;
  return addon?.onContextLoss(() => addon.dispose());
}

interface RenderServiceHost {
  readonly cols: number;
  readonly rows: number;
  readonly _core?: { readonly _renderService?: { handleResize(cols: number, rows: number): void } };
}

/**
 * Redraw a terminal from scratch as its card is shown again, the way a manual
 * resize does: rebuild its own render model at its current size. Not
 * `clearTextureAtlas()`: xterm shares one glyph atlas between every terminal
 * with the same font and colours, and only the caller rebuilds after a clear,
 * so every other terminal kept drawing from positions now holding other
 * glyphs until it was resized. Reads xterm's private render service; absent,
 * this is a no-op.
 */
export function redrawShownTerminal(terminal: object): void {
  try {
    const xterm = (terminal as { getTerminal?: () => RenderServiceHost }).getTerminal?.();
    xterm?._core?._renderService?.handleResize(xterm.cols, xterm.rows);
  } catch {
    /* terminal not opened yet */
  }
}
