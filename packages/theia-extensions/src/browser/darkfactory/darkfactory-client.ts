import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { SpexrDarkfactoryClient, AgentTile } from "../../common/darkfactory-protocol.js";

export const SpexrDarkfactoryClientToken = Symbol("SpexrDarkfactoryClientDispatcher");

/**
 * Singleton client registered on the Darkfactory RPC proxy. The backend pushes
 * the refreshed tile set and read-only follow chunks here; widgets subscribe.
 */
@injectable()
export class SpexrDarkfactoryClientDispatcher implements SpexrDarkfactoryClient {
  private readonly tiles = new Emitter<AgentTile[]>();
  readonly onTilesChanged$: Event<AgentTile[]> = this.tiles.event;

  private readonly follow = new Emitter<{ sessionId: string; turns: string }>();
  readonly onFollowChunk$: Event<{ sessionId: string; turns: string }> = this.follow.event;

  onTilesChanged(tiles: AgentTile[]): void {
    this.tiles.fire(tiles);
  }

  onFollowChunk(sessionId: string, turns: string): void {
    this.follow.fire({ sessionId, turns });
  }
}
