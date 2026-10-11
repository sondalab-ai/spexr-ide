import { inject, injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { SpexrDarkfactoryServiceProxy, type SpexrDarkfactoryService } from "../darkfactory/darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "../darkfactory/darkfactory-client.js";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { AgentsCount, type AgentsView } from "./agents-count.js";

/**
 * The number of running agents, once for the window (S6d, A3): the title bar's
 * pill and the Agent tile's badge read it, so they always say the same number
 * and share one hold timer and one backend read. It counts as the wall does
 * (`AgentsCount`: Dark Factory's pushes and a read of the last scan, held as
 * the wall holds a turn's end). Dark Factory pushes reach only the newest
 * window, so every other one reads the last scan when it comes to the front.
 */
@injectable()
export class SpexrAgentsCountService implements FrontendApplicationContribution {
  @inject(SpexrDarkfactoryServiceProxy) private readonly darkfactory!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly client!: SpexrDarkfactoryClientDispatcher;

  private readonly counter = new AgentsCount();
  private running = 0;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly changed = new Emitter<number>();
  private readonly onFocus = (): void => void this.read();
  private subscription: { dispose(): void } | undefined;

  /** Fires with the new count when it changes. */
  get onDidChange(): Event<number> {
    return this.changed.event;
  }

  /** How many agents are running now. */
  get count(): number {
    return this.running;
  }

  onStart(): void {
    this.subscription = this.client.onTilesChanged$((tiles) => this.show(this.counter.push(tiles, Date.now())));
    void this.read();
    window.addEventListener("focus", this.onFocus);
  }

  onStop(): void {
    window.removeEventListener("focus", this.onFocus);
    this.subscription?.dispose();
    clearTimeout(this.holdTimer);
    this.changed.dispose();
  }

  /** Read the backend's last scan (currentTiles: no scan, no side effects), one read at a time; a push that lands meanwhile wins. */
  private async read(): Promise<void> {
    const token = this.counter.startRead();
    if (token === undefined) return;
    let tiles: AgentTile[] | undefined;
    try {
      tiles = await this.darkfactory.currentTiles();
    } catch {
      // The backend is not up yet: the next push or focus reads again.
    }
    this.show(this.counter.finishRead(token, tiles, Date.now()));
  }

  /** Keep a count, and look again when the earliest hold runs out, with no new scan. */
  private show(view: AgentsView | undefined): void {
    if (!view) return;
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    if (view.nextExpiry !== undefined) {
      this.holdTimer = setTimeout(() => this.show(this.counter.expire(Date.now())), Math.max(0, view.nextExpiry - Date.now()));
    }
    if (this.running === view.count) return;
    this.running = view.count;
    this.changed.fire(view.count);
  }
}
