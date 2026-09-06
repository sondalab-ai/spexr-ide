import { injectable, inject } from "@theia/core/shared/inversify";
import { WidgetManager } from "@theia/core/lib/browser/widget-manager";
import { ViewContainer, type ViewContainerPart } from "@theia/core/lib/browser/view-container";
import { ScmService } from "@theia/scm/lib/browser/scm-service";
import { SCM_VIEW_CONTAINER_ID } from "@theia/scm/lib/browser/scm-contribution";
import { ScmRepositoriesWidget } from "@theia/scm/lib/browser/scm-repositories-widget";
import type { RevealOnRestoreView } from "../shell/reveal-on-restore.js";
import { repositoriesWeights, shouldReveal } from "./scm-reveal-policy.js";

/**
 * Shows the SCM panel's "Repositories" section on launch once the workspace
 * holds more than one repository.
 *
 * Theia already intends this — `ScmRepositoriesWidget` unhides itself past two
 * repositories — but it cannot work here for two compounding reasons. Its
 * reveal runs inside `init()` under `@postConstruct`, while `parent` is still
 * null, and the view container then adds the widget with `initiallyHidden:
 * true`; and once a layout has been saved with the section hidden, every later
 * launch restores that hidden state. {@link SpexrGitScmRegistry} registers all
 * repositories during `onStart`, so neither of Theia's windows of opportunity
 * ever opens.
 *
 * Registered as a {@link SpexrRevealOnRestore} view rather than as its own
 * contribution: that registry exists for exactly this class of problem (a
 * default that a previously-saved layout would otherwise veto), and it runs
 * after `openSideViews`, so the SCM container is already there to be found.
 */
@injectable()
export class ScmRepositoriesRevealView implements RevealOnRestoreView {
  @inject(WidgetManager)
  private readonly widgetManager!: WidgetManager;

  @inject(ScmService)
  private readonly scmService!: ScmService;

  /**
   * Options are accepted for the {@link RevealOnRestoreView} shape and ignored:
   * this only ever reveals, never activates — the section must appear without
   * stealing focus from whatever view the launch landed on.
   *
   * Deliberately synchronous inside, and deliberately NOT
   * `ApplicationShell.revealWidget`: that awaits `waitForRevealed`, an
   * untimed poll for the widget becoming visible, and a part that is hidden
   * *and* collapsed — which is exactly what the saved layout holds — keeps its
   * wrapped widget hidden, so the poll never settles. Awaiting it deadlocked
   * `revealRegisteredDefaults`, and with it every `onDidInitializeLayout`
   * contribution behind it, including the one that launches the agent
   * terminal. Setting the two flags directly cannot block.
   */
  async openView(): Promise<unknown> {
    if (!shouldReveal(this.scmService.repositories.length)) return undefined;
    const container = this.widgetManager.tryGetWidget<ViewContainer>(SCM_VIEW_CONTAINER_ID);
    if (!(container instanceof ViewContainer)) return undefined;
    const widget = this.widgetManager.tryGetWidget(ScmRepositoriesWidget.ID);
    const part = widget && container.getPartFor(widget);
    if (!part) return undefined;
    // Only size a section this reveal is the one to show: a user who has already
    // dragged it taller has a size saved in the layout, and it is theirs to keep.
    const wasOff = part.isHidden || part.collapsed;
    part.setHidden(false);
    // Both flags matter: a part that is shown but collapsed is a bare
    // "REPOSITORIES" header with no repositories under it.
    part.collapsed = false;
    if (wasOff) this.applyDefaultSize(container, part);
    return widget;
  }

  /**
   * Give the section a quarter of the container instead of the half a freshly
   * revealed part inherits. A part that comes back from the saved layout with no
   * size of its own is weighted with the average of the others, which against a
   * lone "Changes" section is an even split.
   *
   * Deferred when the container has not been laid out yet — the SCM view is
   * typically a hidden side-panel widget at reveal time, and `setPartSizes` on a
   * zero-height container silently does nothing. The listener is one-shot, so it
   * cannot fight a size the user sets later.
   */
  private applyDefaultSize(container: ViewContainer, part: ViewContainerPart): void {
    const layout = container.containerLayout;
    const parts = container.getParts();
    const weights = repositoriesWeights(
      parts.map((p) => !p.isHidden && !p.collapsed),
      parts.indexOf(part),
    );
    if (!weights.some((w) => w !== undefined)) return;
    if (layout.getAvailableSize() > 0) {
      layout.setPartSizes(weights);
      return;
    }
    const pending = container.onDidChangeVisibility((visible) => {
      if (!visible || layout.getAvailableSize() <= 0) return;
      pending.dispose();
      layout.setPartSizes(weights);
    });
  }
}
