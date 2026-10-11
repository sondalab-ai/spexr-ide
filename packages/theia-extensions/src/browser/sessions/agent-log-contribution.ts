import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution, type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { AGENT_LOG_VIEW_ID, type AgentLogWidget } from "./agent-log-widget.js";

/**
 * Where the Agent log sits among the bottom panel's tabs: after the terminals
 * and the panels Theia and spexr add (Problems, Output). The tab order of the
 * whole panel is the bottom-panel slice's to decide; this is only "last".
 */
export const AGENT_LOG_RANK = 1000;

/** The Agent log: a bottom-panel tab, added on every launch without taking the front. */
@injectable()
export class AgentLogViewContribution extends AbstractViewContribution<AgentLogWidget> implements FrontendApplicationContribution {
  constructor() {
    super({
      widgetId: AGENT_LOG_VIEW_ID,
      widgetName: nls.localize("spexr/agentLog/title", "Agent log"),
      defaultWidgetOptions: { area: "bottom", rank: AGENT_LOG_RANK },
      toggleCommandId: "spexr.view.agent-log.toggle",
    });
  }

  async onDidInitializeLayout(): Promise<void> {
    // The terminal stays in front: the tab is there, not raised.
    await this.openView({ activate: false, reveal: false });
  }
}
