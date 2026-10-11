/**
 * The left activity bar's views (S6d, A1/A2, D13): Lumen's bar is Explorer,
 * Search, Source Control, Agent, Testing. Debug and Extensions are not on it
 * by default; they stay one View-menu entry or palette command away.
 *
 * Kept free of Theia so the order and the migration run in plain node.
 */
import { runMigrationOnce, type MigrationStore } from "./explorer-sections.js";

/** The Debug view container's widget id (`DebugWidget.ID`). */
export const DEBUG_VIEW_ID = "debug";

/** The Extensions view container's widget id (`VSXExtensionsViewContainer.ID`). */
export const EXTENSIONS_VIEW_ID = "vsx-extensions-view-container";

/** The views that are not in the default activity bar. */
export const REMOVED_ACTIVITY_VIEWS: readonly string[] = [DEBUG_VIEW_ID, EXTENSIONS_VIEW_ID];

/**
 * The left bar's ranks, Theia's own except the agent's: Explorer 100, Search
 * 200, Source Control 300, Testing 600. The agent terminal sits between
 * Source Control and Testing (it was first, rank 1, before S6d), so Debug
 * (400) and Extensions (500) would follow it if the user shows them.
 */
export const AGENT_LEFT_RANK = 350;

/** The id the one-time removal is recorded under, in the left island's migration list (explorer-sections.ts). */
export const ACTIVITY_VIEWS_MIGRATION_ID = "activity-views-removed";

/** What the removal reads and does to the shell's left widgets. */
export interface ActivityViews {
  /** Whether a widget with this id is attached. */
  has(widgetId: string): boolean;
  /** Close it. */
  close(widgetId: string): Promise<void> | void;
}

/**
 * Close Debug and Extensions where a layout has them (one restored from before
 * S6d, or one Theia just built, since their contributions open them on a
 * fresh layout), once per workspace. Returns whether it ran. Reset Layout
 * clears the list, so it runs again on the layout the reset builds. A view
 * the user shows afterwards stays: the id is recorded.
 */
export function removeActivityViewsOnce(store: MigrationStore, views: ActivityViews): Promise<boolean> {
  return runMigrationOnce(store, ACTIVITY_VIEWS_MIGRATION_ID, async () => {
    for (const id of REMOVED_ACTIVITY_VIEWS) if (views.has(id)) await views.close(id);
  });
}
