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

/** The islands' sizes on a first launch: Lumen's Explorer, agent pane and bottom panel. */
export const FIRST_LAUNCH_ISLANDS: Readonly<Record<ShellArea, number>> = { left: 264, right: 352, bottom: 204 };

/** {@link FIRST_LAUNCH_ISLANDS} as Theia's sizes ({@link areaSize}). */
export function firstLaunchSizes(islands: Readonly<Record<ShellArea, number>> = FIRST_LAUNCH_ISLANDS): Record<ShellArea, number> {
  return { left: areaSize("left", islands.left), right: areaSize("right", islands.right), bottom: areaSize("bottom", islands.bottom) };
}

/** The part of Theia's `ApplicationShell` first-launch sizing touches; structural, so a fake shell tests it. */
export interface SizingShell {
  readonly pendingUpdates: Promise<unknown>;
  resize(size: number, area: ShellArea): void;
}

/**
 * Lumen's sizes for a layout spexr made itself, never for one Theia restored.
 *
 * Theia calls a contribution's `initializeLayout` only when it had no stored
 * layout to restore (a first launch, or after the stored layout was
 * dropped), so that is when {@link markDefaultLayout} runs. {@link apply}
 * runs once the default views are open: it waits for Theia's pending panel
 * moves (an expansion, a floor) to settle first, so the sizes here are the
 * last ones set, and does nothing after a restore.
 */
export class FirstLaunchSizing {
  private pending = false;

  /** Theia found no layout to restore: the next {@link apply} sizes the areas. */
  markDefaultLayout(): void {
    this.pending = true;
  }

  /**
   * Resize each area to its first-launch size, once. A collapsed side or a
   * hidden bottom panel takes the size as the one it opens at (Theia keeps it
   * as the area's last size). Resolves when Theia has applied them.
   */
  async apply(shell: SizingShell, sizes: Readonly<Record<ShellArea, number>> = firstLaunchSizes()): Promise<boolean> {
    if (!this.pending) return false;
    this.pending = false;
    await shell.pendingUpdates;
    for (const area of SHELL_AREAS) shell.resize(sizes[area], area);
    await shell.pendingUpdates;
    return true;
  }
}
