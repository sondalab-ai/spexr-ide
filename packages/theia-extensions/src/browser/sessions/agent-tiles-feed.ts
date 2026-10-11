import { inject, injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { SpexrDarkfactoryClientDispatcher } from "../darkfactory/darkfactory-client.js";
import { SpexrDarkfactoryServiceProxy, type SpexrDarkfactoryService } from "../darkfactory/darkfactory-service-proxy.js";
import { AgentsCount } from "../titlebar/agents-count.js";

/**
 * The sessions of every project, as Dark Factory scans them, for the Sessions
 * part and the status bar's agents pill. It keeps what the title bar's badge
 * keeps (AgentsCount: pushes, reads of the backend's last scan when the window
 * comes to the front, the hold on a turn that ends), so the pill's number is
 * the badge's. Reads never start a scan.
 */
@injectable()
export class AgentTilesFeed {
  @inject(SpexrDarkfactoryServiceProxy) private readonly service!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly client!: SpexrDarkfactoryClientDispatcher;

  // To be replaced by SpexrAgentsCountService (lane B, S6d), the one shared count of the title pill and the
  // activity badge, when the stacks meet; this feed keeps its own AgentsCount until then so S6j stands alone.
  private readonly count = new AgentsCount();
  private readonly changed = new Emitter<void>();
  readonly onDidChange: Event<void> = this.changed.event;
  private all: readonly AgentTile[] = [];
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private started = false;

  /** Every tile of the last scan, in every project. */
  tiles(): readonly AgentTile[] {
    return this.all;
  }

  /** The working tiles the count counts (held as the badge holds them). */
  live(): readonly AgentTile[] {
    return this.count.live();
  }

  /** Begin listening, once: pushes, the window's focus, and a first read. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.client.onTilesChanged$((tiles) => this.accept(tiles, this.count.push(tiles, Date.now())));
    window.addEventListener("focus", () => void this.read());
    void this.read();
  }

  private async read(): Promise<void> {
    const token = this.count.startRead();
    if (token === undefined) return;
    let tiles: AgentTile[] | undefined;
    try {
      tiles = await this.service.currentTiles();
    } catch {
      // The backend is not up yet: the next push or focus reads again.
    }
    const view = this.count.finishRead(token, tiles, Date.now());
    if (view && tiles) this.accept(tiles, view);
  }

  private accept(tiles: readonly AgentTile[], view: { nextExpiry?: number }): void {
    this.all = tiles;
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    if (view.nextExpiry !== undefined) {
      this.holdTimer = setTimeout(() => this.accept(this.all, this.count.expire(Date.now())), Math.max(0, view.nextExpiry - Date.now()));
    }
    this.changed.fire();
  }
}
