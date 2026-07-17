import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { ApplicationShell } from "@theia/core/lib/browser";
import type { AgentTile, SpexrDarkfactoryService } from "../../common/darkfactory-protocol.js";
import { SpexrDarkfactoryServiceProxy } from "./darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "./darkfactory-client.js";
import { SpexrDarkfactoryTerminalManager } from "./darkfactory-terminal-manager.js";
import { SpexrDarkfactoryFollowWidget } from "./follow-pane.js";
import { sortTiles } from "./darkfactory-format.js";
import { AgentTileCard } from "./agent-tile.js";

/** Machine-wide monitoring wall of every Claude Code session ("agent"). */
@injectable()
export class SpexrDarkfactoryWidget extends ReactWidget {
  static readonly ID = "spexr.view.darkfactory";

  @inject(SpexrDarkfactoryServiceProxy) private readonly service!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly client!: SpexrDarkfactoryClientDispatcher;
  @inject(SpexrDarkfactoryTerminalManager) private readonly terminals!: SpexrDarkfactoryTerminalManager;
  @inject(SpexrDarkfactoryFollowWidget) private readonly followPane!: SpexrDarkfactoryFollowWidget;
  @inject(ApplicationShell) private readonly shell!: ApplicationShell;

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
          <AgentTileCard
            key={t.sessionId}
            tile={t}
            now={now}
            onOpen={(tile) =>
              void this.openFocus(tile).catch(() => {
                /* ignore */
              })
            }
          />
        ))}
      </div>
    );
  }

  /** Open a tile in the focus pane: an interactive resume terminal, or a read-only follow. */
  protected async openFocus(tile: AgentTile): Promise<void> {
    const plan = await this.service.planFocus(tile.sessionId);
    if (plan.kind === "resume-terminal") {
      await this.terminals.openResume(plan.sessionId, plan.projectPath, plan.configDir, false);
      return;
    }
    await this.followPane.follow(plan.sessionId, plan.projectPath, plan.configDir, tile.projectName);
    await this.shell.addWidget(this.followPane, { area: "main" });
    await this.shell.activateWidget(this.followPane.id);
  }
}
