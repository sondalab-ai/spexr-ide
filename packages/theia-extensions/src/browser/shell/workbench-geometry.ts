import { ISLAND_GAP } from "./islands.js";

/**
 * Lumen's workbench geometry in spexr: the Lumen IDE demo at 1440×900
 * (tests/visual/reference/demo-regions.json) on the kit's 4px grid (owner,
 * 2026-10-05). Where the demo sits between two grid steps, the kit's own
 * value for that piece decides (ui-kit 0.34 README, "For spexr"): a 28px
 * status bar with 20px items (Lumen 30 / 22), 24px tree rows (26), 36px
 * activity items 8px apart (38, 6 apart: the same 44px pitch). Radii and type
 * sizes are shape, not spacing, so Lumen's own are kept.
 *
 * spexr.css repeats these numbers (CSS cannot read them from here); the style
 * guards (theme/workbench-style.test.ts) hold the two together, so a value
 * changes here and in spexr.css in one edit.
 */
export const WORKBENCH = {
  /** The title bar (S5b-1), Lumen's 44. */
  titleBar: 44,
  /** The status bar: the kit's 28 (Lumen 30). */
  statusBar: 28,
  /** A status item, a pill 4px inside the bar: the kit's 20 (Lumen 22). */
  statusItem: 20,
  /** The activity bar's column: Lumen's 52. */
  activityBar: 52,
  /** An activity item: the kit's 36 (Lumen 38), r9. */
  activityItem: 36,
  /** Between two activity items: the kit's 8 (Lumen 6), so the pitch stays Lumen's 44. */
  activityGap: 8,
  /** The first activity item's distance from the bar's top: Lumen's 4. */
  activityTop: 4,
  /** The bar's foot (settings, accounts): its last tile's distance from the bar's bottom, Lumen's 8. */
  activityBottom: 8,
  /** A tab strip, the editor's and the bottom island's: 36 (Lumen 38). */
  tabStrip: 36,
  /** A tile tab: the kit's 28, the editor's r7 and the bottom's r6 (Lumen 28 and 26). */
  tab: 28,
  /** The breadcrumbs under the editor's tabs: 32 (Lumen 30), so the code starts where Lumen's does (38 + 30 = 36 + 32). */
  breadcrumbs: 32,
  /** A file tree's row: the kit's 24 (Lumen 26). */
  treeRow: 24,
  /** A tree level's indent: Lumen's 16. */
  treeIndent: 16,
  /** A side island's head (Explorer): Lumen's 40. */
  paneHead: 40,
  /** A toast's distance from the window's bottom edge: Lumen's 48. */
  toastOffset: 48,
} as const;

/** A shell area Theia can resize. */
export type ShellArea = "left" | "right" | "bottom";

export const SHELL_AREAS: readonly ShellArea[] = ["left", "right", "bottom"];

/**
 * The column an activity bar takes: the bar, and the island gap between it
 * and its island (spexr.css pads the column on the island's side, so the gap
 * is inside what Theia measures as the side's size).
 */
export const ACTIVITY_COLUMN = WORKBENCH.activityBar + ISLAND_GAP;

/**
 * Theia's size for an area whose island is `island` px across (or tall), the
 * number `ApplicationShell.resize` takes. Theia measures an area from the
 * window's edge to the area's split handle (`SidePanelHandler.getPanelSize`,
 * `ApplicationShell.getBottomPanelSize`):
 * - left: the activity column and the island, up to the handle's offset;
 * - right: the handle (the gap to the main island), the island and the column;
 * - bottom: the handle and the island.
 */
export function areaSize(area: ShellArea, island: number): number {
  switch (area) {
    case "left":
      return ACTIVITY_COLUMN + island;
    case "right":
      return ISLAND_GAP + island + ACTIVITY_COLUMN;
    case "bottom":
      return ISLAND_GAP + island;
  }
}

/** Lumen's Explorer island (px): the left island of a default layout with the Explorer in front. */
export const EXPLORER_ISLAND = 264;

/**
 * The agent terminal's island (px), and its floor: the 432px the left island
 * had when the floor was Theia's 480 with a 48px activity bar. A 264px agent
 * terminal would be about 33 columns.
 */
export const AGENT_ISLAND = 432;

/** The right island (px), Lumen's agent pane: spec/memory/experts default to it, and never go narrower. */
export const RIGHT_ISLAND = 352;

/** The bottom island (px), Lumen's panel. */
export const BOTTOM_ISLAND = 204;

/**
 * The islands of a default layout: Lumen's, with the left island the agent
 * terminal's when it is the left view in front, the Explorer's otherwise.
 */
export function defaultIslands(agentInFront: boolean): Record<ShellArea, number> {
  return { left: agentInFront ? AGENT_ISLAND : EXPLORER_ISLAND, right: RIGHT_ISLAND, bottom: BOTTOM_ISLAND };
}

/** {@link defaultIslands} as Theia's sizes ({@link areaSize}). */
export function defaultSizes(agentInFront: boolean): Record<ShellArea, number> {
  const islands = defaultIslands(agentInFront);
  return { left: areaSize("left", islands.left), right: areaSize("right", islands.right), bottom: areaSize("bottom", islands.bottom) };
}

/**
 * The part of Theia's `ApplicationShell` the default layout touches;
 * structural, so a fake shell tests it. `getLayoutData` is the public way to
 * read each area's size back: a showing area's measured size, a hidden one's
 * stored size.
 */
export interface SizingShell {
  readonly pendingUpdates: Promise<unknown>;
  resize(size: number, area: ShellArea): void;
  getLayoutData(): { readonly [K in "leftPanel" | "rightPanel" | "bottomPanel"]?: { readonly size?: number | undefined } };
}

/** Where the default layout reports: a warning, and the layout's settled mark. */
export interface LayoutReporter {
  warn(message: string, ...detail: unknown[]): void;
  markSettled(): void;
}

const LAYOUT_DATA_KEY: Record<ShellArea, "leftPanel" | "rightPanel" | "bottomPanel"> = { left: "leftPanel", right: "rightPanel", bottom: "bottomPanel" };

/**
 * spexr's default layout sizes, decided once, and the mark that the layout
 * has settled.
 *
 * - {@link seed} runs from `initializeLayout`, which Theia calls only when it
 *   had no stored layout to restore (the first open of a workspace, or after
 *   the stored layout was dropped), before any panel shows. Theia keeps a
 *   size given to a collapsed side or a hidden bottom panel as the size it
 *   opens at, so the panels open at their final size, with no reflow. The
 *   left island is decided there: the agent terminal's when it will be in
 *   front, so its floor never moves it.
 * - {@link settle} runs from the last `onDidInitializeLayout`: it reads the
 *   seeded sizes back, warns where one did not land, and marks the layout
 *   settled, whatever happened, on every launch.
 * - {@link reset} is Reset Layout: the default sizes again, applied now.
 *
 * Nothing here throws: a failure is a warning, and the mark is still set.
 */
export class DefaultLayout {
  private seeded: Record<ShellArea, number> | undefined;

  constructor(private readonly reporter: LayoutReporter) {}

  /** Size every area for a layout spexr makes itself. */
  seed(shell: SizingShell, agentInFront: boolean): void {
    const sizes = defaultSizes(agentInFront);
    try {
      for (const area of SHELL_AREAS) shell.resize(sizes[area], area);
      this.seeded = sizes;
    } catch (err) {
      this.reporter.warn("[spexr] the default layout's sizes could not be set", err);
    }
  }

  /** Check the seeded sizes landed, then mark the layout settled. */
  async settle(shell: SizingShell): Promise<void> {
    try {
      if (this.seeded) await this.check(shell, this.seeded);
    } catch (err) {
      this.reporter.warn("[spexr] the default layout's sizes could not be read back", err);
    } finally {
      this.seeded = undefined;
      this.reporter.markSettled();
    }
  }

  /** Reset Layout: apply the default sizes now, the left island by the view in front. */
  async reset(shell: SizingShell, agentInFront: boolean): Promise<void> {
    const sizes = defaultSizes(agentInFront);
    try {
      await shell.pendingUpdates;
      for (const area of SHELL_AREAS) shell.resize(sizes[area], area);
      await this.check(shell, sizes);
    } catch (err) {
      this.reporter.warn("[spexr] Reset Layout's sizes could not be set", err);
    }
  }

  /** The areas whose size, read back, is more than a pixel off; each is warned about. */
  private async check(shell: SizingShell, sizes: Readonly<Record<ShellArea, number>>): Promise<ShellArea[]> {
    await shell.pendingUpdates;
    const data = shell.getLayoutData();
    const off = SHELL_AREAS.filter((area) => {
      const size = data[LAYOUT_DATA_KEY[area]]?.size;
      return size !== undefined && Math.abs(size - sizes[area]) > 1;
    });
    if (off.length > 0) {
      this.reporter.warn(
        "[spexr] the default layout's sizes did not land",
        Object.fromEntries(off.map((area) => [area, { asked: sizes[area], got: data[LAYOUT_DATA_KEY[area]]?.size }])),
      );
    }
    return off;
  }
}
