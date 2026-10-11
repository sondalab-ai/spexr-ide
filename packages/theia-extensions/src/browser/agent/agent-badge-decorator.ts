import { inject, injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import type { Title } from "@theia/core/shared/@lumino/widgets";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import type { TabBarDecorator } from "@theia/core/lib/browser/shell/tab-bar-decorator";
import type { WidgetDecoration } from "@theia/core/lib/browser/widget-decoration";
import { SpexrAgentsCountService } from "../titlebar/agents-count-service.js";
import { agentBadge } from "./agent-badge.js";

/**
 * Puts the running-agents count on the Agent tile (S6d, A3). The count is the
 * title bar's own (`SpexrAgentsCountService`), so the two always say the same
 * number. The decoration also carries the count in words as a tooltip ("2
 * agents running"), since the badge itself is a bare number; Theia appends it
 * to the tab's own tooltip, so nothing of the tab is mutated.
 */
@injectable()
export class SpexrAgentBadgeDecorator implements TabBarDecorator, FrontendApplicationContribution {
  readonly id = "spexr-agent-badge-decorator";

  @inject(SpexrAgentsCountService) private readonly count!: SpexrAgentsCountService;

  private readonly changed = new Emitter<void>();
  private subscription: { dispose(): void } | undefined;

  get onDidChangeDecorations(): Event<void> {
    return this.changed.event;
  }

  onStart(): void {
    this.subscription = this.count.onDidChange(() => this.changed.fire());
  }

  onStop(): void {
    this.subscription?.dispose();
    this.changed.dispose();
  }

  decorate(title: Title<Widget>): WidgetDecoration.Data[] {
    return agentBadge(title.owner.id, this.count.count);
  }
}
