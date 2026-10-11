/**
 * Where the editor area is, published for the CSS that floats above it: the
 * command palette is centred on the editor island and the toasts end at its
 * right edge (Lumen's, S5f), not on the window's. CSS cannot read the
 * island's place, so the shell writes it on the document root as three
 * lengths and keeps them current while the sides open, close and resize.
 */

/** The variables spexr.css reads (its `:root` carries a whole-window fallback for each). */
export const EDITOR_ANCHOR_VARS = {
  /** The island's left edge, from the window's left. */
  start: "--spexr-editor-start",
  /** The island's right edge, from the window's right. */
  end: "--spexr-editor-end",
  /** The island's width. */
  width: "--spexr-editor-width",
} as const;

/** The part of an element's box the anchor reads; a `DOMRect` satisfies it. */
export interface EditorBox {
  readonly left: number;
  readonly right: number;
}

/**
 * The anchor's variables for an editor island at `box` in a window
 * `windowWidth` across, in whole pixels. Nothing while the island has no
 * width (hidden, or not laid out yet).
 */
export function editorAnchor(box: EditorBox, windowWidth: number): Record<string, string> | undefined {
  const start = Math.round(box.left);
  const width = Math.round(box.right) - start;
  if (!(width > 0)) return undefined;
  return {
    [EDITOR_ANCHOR_VARS.start]: `${start}px`,
    [EDITOR_ANCHOR_VARS.end]: `${Math.round(windowWidth - box.right)}px`,
    [EDITOR_ANCHOR_VARS.width]: `${width}px`,
  };
}

/** The slice of the root element the anchor writes to; `HTMLElement` satisfies it. */
export interface AnchorRoot {
  readonly style: { setProperty(name: string, value: string): void; removeProperty(name: string): string };
}

/**
 * Write the anchor's variables on `root`, or, while the island has no width,
 * remove them: the CSS then falls back to the whole window, never to where
 * the island last was.
 */
export function publishEditorAnchor(root: AnchorRoot, box: EditorBox, windowWidth: number): void {
  const vars = editorAnchor(box, windowWidth);
  if (!vars) {
    for (const name of Object.values(EDITOR_ANCHOR_VARS)) root.style.removeProperty(name);
    return;
  }
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
}

/** The slice of a window the tracking needs: a `ResizeObserver` and the width. */
export interface AnchorWindow {
  readonly innerWidth: number;
  readonly ResizeObserver: new (callback: () => void) => { observe(target: unknown): void; disconnect(): void };
}

/**
 * Publish the editor island's place on `root` now, and again whenever the
 * island or one of the sides changes size (a side opening moves the island's
 * left edge and resizes it, and a window resize resizes it too). Returns what
 * stops the tracking.
 */
export function trackEditorAnchor(
  root: AnchorRoot,
  win: AnchorWindow,
  main: { getBoundingClientRect(): EditorBox },
  sides: readonly object[],
): { dispose(): void } {
  const publish = (): void => publishEditorAnchor(root, main.getBoundingClientRect(), win.innerWidth);
  const observer = new win.ResizeObserver(publish);
  for (const element of [main, ...sides]) observer.observe(element);
  publish();
  return { dispose: () => observer.disconnect() };
}
