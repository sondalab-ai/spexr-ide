import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import { AGENT_PANE_VIEW_ID } from "../agent-pane/agent-pane-view-contribution.js";
import { EXPERTS_VIEW_ID } from "../views/experts-view-contribution.js";
import { MEMORY_VIEW_ID } from "../views/memory-view-contribution.js";
import { TODO_VIEW_ID } from "../todo/todo-view-contribution.js";
import { syncPanelTitle } from "./panel-title.js";

/** Right-panel views that open with their own head (PanelHead). */
const SELF_TITLED = new Set([AGENT_PANE_VIEW_ID, MEMORY_VIEW_ID, EXPERTS_VIEW_ID, TODO_VIEW_ID]);

/**
 * Drops the right side panel's small title row while Memory, Experts or TODO
 * shows, since each already opens with the same name as a heading. Re-checked
 * on every tab switch; other views keep the row.
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
