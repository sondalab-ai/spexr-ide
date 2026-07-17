import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import type { AgentTile, SpexrDarkfactoryService } from "../../common/darkfactory-protocol.js";
import { SpexrDarkfactoryServiceProxy } from "./darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "./darkfactory-client.js";
import { sortTiles } from "./darkfactory-format.js";
import { AgentTileCard } from "./agent-tile.js";

/** Machine-wide monitoring wall of every Claude Code session ("agent"). */
@injectable()
export class SpexrDarkfactoryWidget extends ReactWidget {
  static readonly ID = "spexr.view.darkfactory";

  @inject(SpexrDarkfactoryServiceProxy) private readonly service!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly client!: SpexrDarkfactoryClientDispatcher;

  private tiles: AgentTile[] = [];

  @postConstruct()
  protected init(): void {
    this.id = SpexrDarkfactoryWidget.ID;
    this.title.label = "Darkfactory";
    this.title.caption = "All Claude agents at work";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-server-process";
    this.addClass("spexr-darkfactory");
    this.toDispose.push(this.client.onTilesChanged$((tiles) => this.setTiles(tiles)));
    this.refresh().catch(() => {
      /* ignore */
    });
  }

  private async refresh(): Promise<void> {
    this.setTiles(await this.service.listTiles());
  }

  private setTiles(tiles: AgentTile[]): void {
    this.tiles = tiles;
    this.update();
  }

  protected render(): React.ReactNode {
    const now = Date.now();
    const tiles = sortTiles(this.tiles);
    if (tiles.length === 0) {
      return (
        <div className="spexr-df-empty">No Claude agents found. Start a session to see it here.</div>
      );
    }
    return (
      <div className="spexr-df-wall">
        {tiles.map((t) => (
          <AgentTileCard key={t.sessionId} tile={t} now={now} onOpen={(tile) => this.openFocus(tile)} />
        ))}
      </div>
    );
  }

  /** Open a tile in the focus pane (terminal or read-only follow). Wired in the focus slice. */
  protected openFocus(tile: AgentTile): void {
    void this.service.planFocus(tile.sessionId).catch(() => {
      /* focus wiring lands in the focus slice */
    });
  }
}
