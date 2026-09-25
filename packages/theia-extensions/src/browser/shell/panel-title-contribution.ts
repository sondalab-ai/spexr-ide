import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import { EXPERTS_VIEW_ID } from "../views/experts-view-contribution.js";
import { MEMORY_VIEW_ID } from "../views/memory-view-contribution.js";
import { syncPanelTitle } from "./panel-title.js";

/** Right-panel views that open with their own heading. */
const SELF_TITLED = new Set([MEMORY_VIEW_ID, EXPERTS_VIEW_ID]);

/**
 * Drops the right side panel's small title row while Memory or Experts shows,
 * since both already open with the same name as a heading. Re-checked on every
 * tab switch; other views keep the row.
 */
@injectable()
export class SpexrPanelTitleContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  onStart(): void {
    const handler = this.shell.rightPanelHandler;
    const sync = (): void => syncPanelTitle(handler, SELF_TITLED);
    handler.tabBar.currentChanged.connect(sync);
    sync();
  }
}
