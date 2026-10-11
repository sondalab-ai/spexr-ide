import { inject, injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import type { Title } from "@theia/core/shared/@lumino/widgets";
import { ApplicationShell } from "@theia/core/lib/browser";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import type { TabBarDecorator } from "@theia/core/lib/browser/shell/tab-bar-decorator";
import type { WidgetDecoration } from "@theia/core/lib/browser/widget-decoration";
import { SpexrAgentsCountService } from "../titlebar/agents-count-service.js";
import { agentsLabel } from "../titlebar/titlebar-model.js";
import { agentBadge, agentTabCaption } from "./agent-badge.js";
import { CLAUDE_TERMINAL_ID } from "./claude-terminal-id.js";

/**
 * Puts the running-agents count on the Agent tile (S6d, A3). The count is the
 * title bar's own (`SpexrAgentsCountService`), so the two always say the same
 * number. The tab's caption, its tooltip, also says it in words ("2 agents
 * running"), since the badge itself is a bare number.
 */
@injectable()
export class SpexrAgentBadgeDecorator implements TabBarDecorator, FrontendApplicationContribution {
  readonly id = "spexr-agent-badge-decorator";

  @inject(SpexrAgentsCountService) private readonly count!: SpexrAgentsCountService;
  @inject(ApplicationShell) private readonly shell!: ApplicationShell;

  private readonly changed = new Emitter<void>();
  private baseCaption: string | undefined;
  private subscription: { dispose(): void } | undefined;

  get onDidChangeDecorations(): Event<void> {
    return this.changed.event;
  }

  onStart(): void {
    this.subscription = this.count.onDidChange(() => {
      this.captionAgentTab();
      this.changed.fire();
    });
  }

  onStop(): void {
    this.subscription?.dispose();
    this.changed.dispose();
  }

  decorate(title: Title<Widget>): WidgetDecoration.Data[] {
    return agentBadge(title.owner.id, this.count.count);
  }

  /** Say the count in the tab's tooltip, and take it away again at 0. */
  private captionAgentTab(): void {
    const widget = this.shell.widgets.find((w) => w.id === CLAUDE_TERMINAL_ID);
    if (!widget) return;
    this.baseCaption ??= widget.title.caption;
    widget.title.caption = agentTabCaption(this.baseCaption, agentsLabel(this.count.count));
  }
}
