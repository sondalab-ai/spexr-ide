/**
 * Lumen islands: the left, main, bottom and right shell areas float as
 * separate rounded panes on the canvas, and the pane that holds the focus is
 * lit. Each area is the kit's `.sl-pane` (workbench.css), and the lit one
 * carries its `data-lit`. These helpers find the four island nodes, tag them
 * and move the lit mark; the shell subclass lays out the gaps and spexr.css
 * adapts the pane to Theia's DOM.
 */

/** Gap (px) between islands, and between the islands and the frame's top and bottom edges. */
export const ISLAND_GAP = 6;

/** Class on the shell node while the island layout is active; scopes the frame rules. */
export const ISLANDS_CLASS = "spexr-islands";

/** Class on each island node; the island rules key on it alone so a maximised area keeps them. */
export const ISLAND_CLASS = "spexr-island";

/** The kit's pane (workbench.css): the island's fill, radius and lit recipe. */
export const PANE_CLASS = "sl-pane";

/** Attribute naming which shell area an island is (`left`, `main`, `bottom`, `right`). */
export const ISLAND_AREA_ATTR = "data-island";

/** Boolean attribute on the one island that holds the focus (the kit's `.sl-pane[data-lit]`). */
export const LIT_ATTR = "data-lit";

export type IslandArea = "left" | "main" | "bottom" | "right";

const ISLAND_AREAS: ReadonlySet<string> = new Set<IslandArea>(["left", "main", "bottom", "right"]);

/** The slice of an island's DOM node these helpers touch; `HTMLElement` satisfies it. */
export interface IslandNode {
  readonly classList: { add(...tokens: string[]): void };
  setAttribute(name: string, value: string): void;
  toggleAttribute(name: string, force: boolean): boolean;
}

interface NodeOwner {
  readonly node: IslandNode;
}

interface SideHandlerLike {
  readonly dockPanel: { readonly parent: NodeOwner | null };
}

/**
 * The part of Theia's `ApplicationShell` the island helpers read. Structural so
 * the helpers can be tested with plain objects.
 */
export interface IslandShell {
  readonly mainPanel: NodeOwner;
  readonly bottomPanel: NodeOwner;
  readonly leftPanelHandler: SideHandlerLike;
  readonly rightPanelHandler: SideHandlerLike;
}

/**
 * The split options for the shell's two splits: the caller's, with the island
 * gap as the spacing. Lumino sizes each split handle to the spacing, so the
 * sash fills the gap, and a hidden area takes its gap with it.
 */
export function islandSplitOptions<T extends { spacing?: number }>(options: T | undefined): T & { spacing: number } {
  return { ...(options as T), spacing: ISLAND_GAP };
}

/**
 * The four island nodes, keyed by area.
 *
 * A side island is the side handler's content panel (title row + dock panel),
 * the dock panel's parent — not the handler's `container`, which also holds the
 * activity bar, and the activity bar sits on the frame.
 */
export function islandNodes(shell: IslandShell): Map<IslandArea, IslandNode> {
  const nodes = new Map<IslandArea, IslandNode>([
    ["main", shell.mainPanel.node],
    ["bottom", shell.bottomPanel.node],
  ]);
  const left = shell.leftPanelHandler.dockPanel.parent;
  const right = shell.rightPanelHandler.dockPanel.parent;
  if (left) nodes.set("left", left.node);
  if (right) nodes.set("right", right.node);
  return nodes;
}

/** Mark each island node as the kit's pane and an island of its area. */
export function tagIslands(islands: ReadonlyMap<IslandArea, IslandNode>): void {
  for (const [area, node] of islands) {
    node.classList.add(ISLAND_CLASS, PANE_CLASS);
    node.setAttribute(ISLAND_AREA_ATTR, area);
  }
}

/** Narrow a shell area (which also has `top` and `secondaryWindow`) to an island area. */
export function toIslandArea(area: string | undefined): IslandArea | undefined {
  return area !== undefined && ISLAND_AREAS.has(area) ? (area as IslandArea) : undefined;
}

/** Light the island for `lit` and unlight the others; `undefined` unlights all. */
export function markLit(islands: ReadonlyMap<IslandArea, IslandNode>, lit: IslandArea | undefined): void {
  for (const [area, node] of islands) {
    node.toggleAttribute(LIT_ATTR, area === lit);
  }
}

/**
 * The part of Theia's `ApplicationShell` the lit tracking reads: its focus
 * tracking, never the DOM's. Structural so it can be tested with a fake shell.
 */
export interface LitShell<W> {
  readonly activeWidget: W | undefined;
  readonly currentWidget: W | undefined;
  getAreaFor(widget: W): string | undefined;
  onDidChangeActiveWidget(listener: () => void): unknown;
  onDidChangeCurrentWidget(listener: () => void): unknown;
}

/**
 * The island to light: the area of the shell's active widget, or of its
 * current (last focused) one while the focus is in a menu, a dialog or the
 * quick pick. Nothing for a widget outside the four islands (the top panel, a
 * secondary window) or before any widget has had the focus.
 */
export function litArea<W>(shell: LitShell<W>): IslandArea | undefined {
  const widget = shell.activeWidget ?? shell.currentWidget;
  return toIslandArea(widget === undefined ? undefined : shell.getAreaFor(widget));
}

/** Light the island {@link litArea} names now, and again whenever the shell's active or current widget changes. */
export function trackLitIsland<W>(shell: LitShell<W>, islands: ReadonlyMap<IslandArea, IslandNode>): void {
  const update = (): void => markLit(islands, litArea(shell));
  shell.onDidChangeActiveWidget(update);
  shell.onDidChangeCurrentWidget(update);
  update();
}
