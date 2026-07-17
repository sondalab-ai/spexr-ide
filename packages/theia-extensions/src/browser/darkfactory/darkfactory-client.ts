import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { SpexrDarkfactoryClient, AgentSession } from "../../common/darkfactory-protocol.js";

export const SpexrDarkfactoryClientToken = Symbol("SpexrDarkfactoryClientDispatcher");

/**
 * Singleton client registered on the Darkfactory RPC proxy. The backend pushes
 * the refreshed agent set here whenever transcripts change; widgets subscribe.
 */
@injectable()
export class SpexrDarkfactoryClientDispatcher implements SpexrDarkfactoryClient {
  private readonly emitter = new Emitter<AgentSession[]>();
  readonly onAgentsChanged$: Event<AgentSession[]> = this.emitter.event;

  onAgentsChanged(agents: AgentSession[]): void {
    this.emitter.fire(agents);
  }
}
