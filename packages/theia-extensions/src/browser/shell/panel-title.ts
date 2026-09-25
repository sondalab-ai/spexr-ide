/** The slice of Theia's `SidePanelHandler` the title sync reads and writes. */
export interface PanelTitleHandler {
  readonly tabBar: { readonly currentTitle: { readonly owner: { readonly id: string } } | null };
  readonly toolBar: { setHidden(hidden: boolean): void };
}

/**
 * Hide the side panel's title row while the showing view names itself.
 *
 * Theia heads a side panel with the current view's label in small caps; views
 * that open with their own heading then show their name twice. The row is
 * hidden as a widget rather than with CSS: Lumino lays the panel out from
 * inline sizes, so a CSS-hidden row would leave its height behind as a gap.
 */
export function syncPanelTitle(handler: PanelTitleHandler, selfTitled: ReadonlySet<string>): void {
  const id = handler.tabBar.currentTitle?.owner.id;
  handler.toolBar.setHidden(id !== undefined && selfTitled.has(id));
}
