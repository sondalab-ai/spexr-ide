import { injectable } from "@theia/core/shared/inversify";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import type { SplitLayout, Widget } from "@theia/core/shared/@lumino/widgets";
import { ISLAND_GAP, ISLANDS_CLASS, islandNodes, islandSplitOptions, tagIslands } from "./islands.js";

/**
 * Theia's application shell laid out as Lumen islands.
 *
 * Theia builds its two shell splits (left | centre | right, and main / bottom)
 * with `spacing: 0`. Routing both through {@link ISLAND_GAP} makes the gaps
 * real layout rather than paint: Lumino sizes each split handle to the
 * spacing, so the sash fills the gap and still resizes, and a hidden area
 * takes its gap with it. Theia's side and bottom panel sizes are read and
 * written through the same handle offsets, so they still round-trip.
 *
 * Only `createSplitLayout` and `initializeShell` are overridden. If a Theia
 * upgrade stops building the shell splits through `createSplitLayout`, the gaps
 * vanish quietly — the islands still render, flush, with no error.
 *
 * No own constructor and no `@postConstruct`: the inherited constructor
 * metadata injects as for `ApplicationShell`, and a decorated `init` here would
 * shadow the base one.
 */
@injectable()
export class SpexrApplicationShell extends ApplicationShell {
  protected override createSplitLayout(
    widgets: Widget[],
    stretch?: number[],
    options?: Partial<SplitLayout.IOptions>,
  ): SplitLayout {
    return super.createSplitLayout(widgets, stretch, islandSplitOptions(options));
  }

  /**
   * Tags the shell and its four areas for spexr.css's island rules, and
   * publishes the gap as `--spexr-island-gap` on the document root — not on the
   * shell node, because a maximised area is re-parented outside the shell and
   * still needs it.
   */
  protected override initializeShell(): void {
    super.initializeShell();
    this.addClass(ISLANDS_CLASS);
    this.node.ownerDocument.documentElement.style.setProperty("--spexr-island-gap", `${ISLAND_GAP}px`);
    tagIslands(islandNodes(this));
  }
}
