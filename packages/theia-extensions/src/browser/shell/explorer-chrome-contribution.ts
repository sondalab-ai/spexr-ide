import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StorageService } from "@theia/core/lib/browser/storage-service";
import { WidgetManager } from "@theia/core/lib/browser/widget-manager";
import type { ViewContainer } from "@theia/core/lib/browser/view-container";
import { EXPLORER_VIEW_CONTAINER_ID, EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS } from "@theia/navigator/lib/browser/navigator-widget-factory";
import { SECTIONS_MIGRATION_KEY, hideSectionsOnce, type ExplorerSections } from "./explorer-sections.js";

/**
 * The Explorer's own chrome (S6b), as Lumen's:
 *
 * - Open Editors and NPM Scripts are hidden once (explorer-sections.ts, D7).
 *   NPM Scripts is a plugin view that attaches after the layout is
 *   initialised, so the migration runs again whenever the container gains a
 *   part, until every section has been decided.
 * - The container keeps the title "Explorer". With one section left Theia
 *   folds that section's name (the project folder) into the container's
 *   title, "Explorer: <folder>", and hides the section header; Lumen has the
 *   folder as the first section's eyebrow under the head "Explorer". The
 *   header itself is brought back by spexr.css (the sole section's title is
 *   hidden by an inline style only CSS can beat).
 */
@injectable()
export class SpexrExplorerChromeContribution implements FrontendApplicationContribution {
  @inject(WidgetManager)
  private readonly widgetManager!: WidgetManager;

  @inject(StorageService)
  private readonly storage!: StorageService;

  private readonly attached = new WeakSet<ViewContainer>();

  async onDidInitializeLayout(): Promise<void> {
    try {
      // The container is made again by Reset Layout (the old one is closed),
      // so the hooks follow every Explorer container Theia creates.
      this.widgetManager.onDidCreateWidget(({ factoryId, widget }) => {
        if (factoryId === EXPLORER_VIEW_CONTAINER_ID) this.attach(widget as ViewContainer);
      });
      this.attach(await this.widgetManager.getOrCreateWidget<ViewContainer>(EXPLORER_VIEW_CONTAINER_ID));
    } catch (err) {
      console.warn("[spexr] the Explorer's chrome could not be set", err);
    }
  }

  /** Keep the container's title and hide its default-hidden sections, once per container. */
  private attach(container: ViewContainer): void {
    if (this.attached.has(container)) return;
    this.attached.add(container);
    const title = container.title;
    const keepTitle = (): void => {
      if (title.label !== EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS.label) title.label = EXPLORER_VIEW_CONTAINER_TITLE_OPTIONS.label;
    };
    title.changed.connect(keepTitle);
    keepTitle();
    container.onDidChangeTrackableWidgets(() => this.migrate(container));
    this.migrate(container);
  }

  /** Hide the default-hidden sections now present, one run at a time. */
  private migrate(container: ViewContainer): void {
    const sections: ExplorerSections = {
      has: (id) => container.getParts().some((part) => part.wrapped.id === id),
      hide: (id) => container.getParts().find((part) => part.wrapped.id === id)?.setHidden(true),
    };
    hideSectionsOnce(
      { load: () => this.storage.getData(SECTIONS_MIGRATION_KEY), save: (ids) => this.storage.setData(SECTIONS_MIGRATION_KEY, ids) },
      sections,
    ).catch((err: unknown) => console.warn("[spexr] the Explorer's sections could not be hidden", err));
  }
}
