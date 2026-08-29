import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution, ApplicationShell } from "@theia/core/lib/browser";
import { SpexrDarkfactorySidebarPolicy } from "./darkfactory-sidebar-policy.js";

/**
 * Hides the project-scoped right side panel while the Darkfactory tab is in
 * front. All the decision logic lives in {@link SpexrDarkfactorySidebarPolicy};
 * this contribution only wires it to the shell's current-widget events.
 */
@injectable()
export class SpexrDarkfactorySidebarVisibilityContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  private policy!: SpexrDarkfactorySidebarPolicy;

  @postConstruct()
  protected init(): void {
    this.policy = new SpexrDarkfactorySidebarPolicy(this.shell);
  }

  /**
   * Listens on the main dock panel rather than `shell.onDidChangeCurrentWidget`:
   * the latter is driven by a Lumino `FocusTracker`, and the Darkfactory widget
   * sets no `tabIndex`, so selecting its tab moves no DOM focus and the tracker
   * never fires. `TheiaDockPanel.onDidChangeCurrent` fires on tab selection
   * itself, and reports the same `mainPanel.currentTitle` the policy reads back
   * through `getCurrentWidget("main")`.
   */
  onStart(): void {
    this.shell.mainPanel.onDidChangeCurrent(() => void this.syncRightPanel());
  }

  /** @param initial See {@link SpexrDarkfactorySidebarPolicy.sync}. */
  async syncRightPanel(initial = false): Promise<void> {
    await this.policy.sync(initial);
  }
}
