import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { SpexrDarkfactoryClient, AgentTile, FollowEvent } from "../../common/darkfactory-protocol.js";

export const SpexrDarkfactoryClientToken = Symbol("SpexrDarkfactoryClientDispatcher");

/**
 * Singleton client registered on the Darkfactory RPC proxy. The backend pushes
 * the refreshed tile set and read-only follow chunks here; widgets subscribe.
 */
@injectable()
export class SpexrDarkfactoryClientDispatcher implements SpexrDarkfactoryClient {
  private readonly tiles = new Emitter<AgentTile[]>();
  readonly onTilesChanged$: Event<AgentTile[]> = this.tiles.event;

  private readonly follow = new Emitter<{ sessionId: string; events: FollowEvent[] }>();
  readonly onFollowChunk$: Event<{ sessionId: string; events: FollowEvent[] }> = this.follow.event;

  onTilesChanged(tiles: AgentTile[]): void {
    this.tiles.fire(tiles);
  }

  onFollowChunk(sessionId: string, events: FollowEvent[]): void {
    this.follow.fire({ sessionId, events });
  }
}
