import { expandRightPanelWithMinWidth, type SidePanelShell } from "../shell/side-panel.js";
import { DARKFACTORY_VIEW_ID } from "./darkfactory-view-id.js";

/** The shell surface the policy needs; `ApplicationShell` satisfies it. */
export interface RightPanelShell extends SidePanelShell {
  getCurrentWidget(area: "main"): { readonly id: string } | undefined;
  isExpanded(area: "right"): boolean;
  collapsePanel(area: "right"): Promise<void>;
}

/**
 * Decides whether the right side panel (memory + experts) should be open.
 *
 * Darkfactory is project-agnostic — it lists agent sessions across workspaces —
 * so the project-scoped side panel has no meaning while that tab is in front.
 * Every other main-area tab belongs to the loaded project and gets it back.
 *
 * Only boundary *transitions* act, and the expanded state is captured on the
 * way in and restored on the way out, so a user who collapsed the panel on a
 * project tab, or expanded it while on Darkfactory, is not fought over.
 */
export class SpexrDarkfactorySidebarPolicy {
  /** Whether the last reconciliation left Darkfactory in front. */
  private inDarkfactory = false;

  /** Expansion state observed the last time Darkfactory came to the front. */
  private restoreExpanded = true;

  /**
   * Serializes reconciliations. A tab switch during the expand animation would
   * otherwise read a still-`expanding` panel as collapsed and latch the panel
   * shut; queueing makes each transition observe a settled state.
   */
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly shell: RightPanelShell) {}

  /**
   * Reconcile the right panel against the main area's current widget. Outside
   * of `initial`, crossing the Darkfactory boundary is what triggers work, so a
   * repeated notification for the tab already in front is a no-op.
   *
   * @param initial Applies the default layout instead of a remembered state.
   *   `SpexrShellLayoutContribution` passes this on launch: the panel is open
   *   by default there, and a collapse this policy performed in a previous
   *   session is persisted in Theia's layout cache, so reading the restored
   *   state back would latch the panel closed for good.
   */
  sync(initial = false): Promise<void> {
    this.queue = this.queue.then(() => this.reconcile(initial));
    return this.queue;
  }

  private async reconcile(initial: boolean): Promise<void> {
    const isDarkfactory = this.shell.getCurrentWidget("main")?.id === DARKFACTORY_VIEW_ID;
    if (!initial && isDarkfactory === this.inDarkfactory) return;
    this.inDarkfactory = isDarkfactory;

    if (initial) this.restoreExpanded = true;
    else if (isDarkfactory) this.restoreExpanded = this.shell.isExpanded("right");

    if (isDarkfactory) {
      if (this.shell.isExpanded("right")) await this.shell.collapsePanel("right");
    } else if (this.restoreExpanded) {
      await expandRightPanelWithMinWidth(this.shell);
    }
  }
}
