/**
 * Explorer sections hidden by default (S6b, D7): Lumen's Explorer is the
 * file tree, and Open Editors and NPM Scripts are not on its screen. They
 * stay re-showable from the section header's menu.
 *
 * The hiding is a migration, not a default: a layout restored from before
 * S6b has them showing, and Theia keeps a part's hidden flag in the layout,
 * so a default the layout can veto would never reach those users. Each
 * section is hidden once, the first time it is seen, and recorded; a section
 * the user shows again is never hidden again.
 */

/** Open Editors, the Explorer's first section (`OpenEditorsWidget.ID`). */
export const OPEN_EDITORS_WIDGET_ID = "theia-open-editors-widget";

/** NPM Scripts: the builtin npm extension's view `npm`, as a plugin view widget (`plugin-view:<view id>`). It attaches after the layout is initialised. */
export const NPM_SCRIPTS_WIDGET_ID = "plugin-view:npm";

/** The sections hidden by default. */
export const HIDDEN_BY_DEFAULT_SECTIONS: readonly string[] = [OPEN_EDITORS_WIDGET_ID, NPM_SCRIPTS_WIDGET_ID];

/** Where the sections already migrated are kept (Theia's `StorageService`): one list, so each section is decided once. */
export const SECTIONS_MIGRATION_KEY = "spexr.migration.explorerSections.v1";

/** The ids read back from storage: the strings in an array, anything else is nothing done. */
export function parseMigrated(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
}

/** The Explorer's parts, as far as the migration reads them. */
export interface ExplorerSections {
  /** Whether the Explorer holds a section for this widget. */
  has(widgetId: string): boolean;
  /** Hide the section. */
  hide(widgetId: string): void;
}

/** Where the migrated ids live. */
export interface MigrationStore {
  load(): Promise<unknown>;
  save(ids: readonly string[]): Promise<void>;
}

/**
 * Hide each default-hidden section that is present and not yet migrated, and
 * record it. A section that is not there yet (a plugin view that attaches
 * later) is left for the next run. Returns the ids hidden by this run.
 * Idempotent: a second run, in this launch or any later one, hides nothing.
 */
export async function hideSectionsOnce(store: MigrationStore, sections: ExplorerSections, ids: readonly string[] = HIDDEN_BY_DEFAULT_SECTIONS): Promise<string[]> {
  const migrated = parseMigrated(await store.load());
  const toHide = ids.filter((id) => !migrated.includes(id) && sections.has(id));
  if (toHide.length === 0) return [];
  for (const id of toHide) sections.hide(id);
  await store.save([...migrated, ...toHide]);
  return toHide;
}
