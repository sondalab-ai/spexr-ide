import { inject, injectable } from "@theia/core/shared/inversify";
import { WidgetManager, type FrontendApplicationContribution } from "@theia/core/lib/browser";
import type { ViewContainer } from "@theia/core/lib/browser/view-container";
import { EXPLORER_VIEW_CONTAINER_ID } from "@theia/navigator/lib/browser/navigator-widget-factory";
import { SESSIONS } from "../shell/workbench-geometry.js";
import { applyPartShare } from "../shell/apply-part-share.js";
import { SessionsWidget } from "./sessions-widget.js";
import { shouldAddSessionsPart } from "./sessions-model.js";

/** Where the Sessions part sits among the Explorer's: after the file tree and the sections after it. */
const SESSIONS_ORDER = 100;

/**
 * Puts the Sessions part at the foot of the Explorer view container. It is done
 * for the container that exists once the layout is initialised and for every
 * one created after it (Reset Layout builds a new Explorer, which would
 * otherwise come without the part), and never twice into the same one.
 */
@injectable()
export class SpexrSessionsContribution implements FrontendApplicationContribution {
  @inject(WidgetManager) private readonly widgetManager!: WidgetManager;

  async onDidInitializeLayout(): Promise<void> {
    this.widgetManager.onDidCreateWidget(({ factoryId, widget }) => {
      void this.attach(factoryId, widget as ViewContainer);
    });
    await this.attach(EXPLORER_VIEW_CONTAINER_ID, (await this.widgetManager.getOrCreateWidget(EXPLORER_VIEW_CONTAINER_ID)) as ViewContainer);
  }

  /** `factoryId` is the container's own: only the Explorer's gets the part. */
  private async attach(factoryId: string, container: ViewContainer): Promise<void> {
    if (!shouldAddSessionsPart(factoryId, EXPLORER_VIEW_CONTAINER_ID, false)) return;
    const widget = await this.widgetManager.getOrCreateWidget<SessionsWidget>(SessionsWidget.ID);
    if (!shouldAddSessionsPart(factoryId, EXPLORER_VIEW_CONTAINER_ID, !!container.getPartFor(widget))) return;
    container.addWidget(widget, { order: SESSIONS_ORDER, canHide: true, initiallyCollapsed: false, weight: SESSIONS.share * 100 });
    // `weight` is not read by the container: the section is capped to its share here.
    const part = container.getPartFor(widget);
    if (part) applyPartShare(container, part, SESSIONS.share);
  }
}
