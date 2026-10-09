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
 * width (hidden, or not laid out yet), so the last place stays.
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

/**
 * Publish the editor island's place on `root` now, and again on every window
 * resize and every size change of the island or of the two sides (a side
 * opening moves the island's left edge, and resizes the island unless the
 * other side gives the pixels back, so the sides are watched too).
 */
export function trackEditorAnchor(root: HTMLElement, main: HTMLElement, sides: readonly HTMLElement[]): void {
  const win = root.ownerDocument.defaultView;
  if (!win) return;
  const publish = (): void => {
    const vars = editorAnchor(main.getBoundingClientRect(), win.innerWidth);
    if (!vars) return;
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
  };
  win.addEventListener("resize", publish);
  const observer = new win.ResizeObserver(publish);
  for (const element of [main, ...sides]) observer.observe(element);
  publish();
}
