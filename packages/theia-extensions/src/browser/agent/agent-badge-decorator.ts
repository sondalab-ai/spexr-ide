import { inject, injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import type { Title } from "@theia/core/shared/@lumino/widgets";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import type { TabBarDecorator } from "@theia/core/lib/browser/shell/tab-bar-decorator";
import type { WidgetDecoration } from "@theia/core/lib/browser/widget-decoration";
import { SpexrDarkfactoryServiceProxy, type SpexrDarkfactoryService } from "../darkfactory/darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "../darkfactory/darkfactory-client.js";
import { AgentsCount, type AgentsView } from "../titlebar/agents-count.js";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { agentBadge } from "./agent-badge.js";

/**
 * Puts the running-agents count on the Agent tile (S6d, A3). It counts as the
 * title bar's pill does (`AgentsCount`: Dark Factory's pushes and a read of
 * the last scan, held as the wall holds a turn's end), so the two always say
 * the same number.
 */
@injectable()
export class SpexrAgentBadgeDecorator implements TabBarDecorator, FrontendApplicationContribution {
  readonly id = "spexr-agent-badge-decorator";

  @inject(SpexrDarkfactoryServiceProxy) private readonly darkfactory!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly client!: SpexrDarkfactoryClientDispatcher;

  private readonly count = new AgentsCount();
  private running = 0;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly changed = new Emitter<void>();

  get onDidChangeDecorations(): Event<void> {
    return this.changed.event;
  }

  onStart(): void {
    this.client.onTilesChanged$((tiles) => this.show(this.count.push(tiles, Date.now())));
    void this.read();
    window.addEventListener("focus", () => void this.read());
  }

  onStop(): void {
    clearTimeout(this.holdTimer);
  }

  decorate(title: Title<Widget>): WidgetDecoration.Data[] {
    return agentBadge(title.owner.id, this.running);
  }

  /** Read the backend's last scan, one read at a time; a push that lands meanwhile wins. */
  private async read(): Promise<void> {
    const token = this.count.startRead();
    if (token === undefined) return;
    let tiles: AgentTile[] | undefined;
    try {
      tiles = await this.darkfactory.currentTiles();
    } catch {
      // The backend is not up yet: the next push or focus reads again.
    }
    this.show(this.count.finishRead(token, tiles, Date.now()));
  }

  /** Keep the count, and look again when the earliest hold runs out. */
  private show(view: AgentsView | undefined): void {
    if (!view) return;
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    if (view.nextExpiry !== undefined) {
      this.holdTimer = setTimeout(() => this.show(this.count.expire(Date.now())), Math.max(0, view.nextExpiry - Date.now()));
    }
    if (this.running === view.count) return;
    this.running = view.count;
    this.changed.fire();
  }
}
