import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import type { AgentPaneWidget } from "./agent-pane-widget.js";

export const AGENT_PANE_VIEW_ID = "spexr.view.agent-pane";

/** The agent pane: the first tile of the right island, and the one in front on a fresh layout. */
@injectable()
export class AgentPaneViewContribution extends AbstractViewContribution<AgentPaneWidget> {
  constructor() {
    super({
      widgetId: AGENT_PANE_VIEW_ID,
      widgetName: nls.localize("spexr/agentPane/title", "Agent"),
      defaultWidgetOptions: {
        area: "right",
        rank: 0,
      },
      toggleCommandId: "spexr.view.agent-pane.toggle",
    });
  }
}
