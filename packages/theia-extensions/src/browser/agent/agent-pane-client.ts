import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import { AGENT_PANE_SERVICE_PATH, type AgentPaneClient, type AgentPaneDelta, type AgentPaneService, type AgentPaneSnapshot } from "../../common/agent-pane-protocol.js";

export { AGENT_PANE_SERVICE_PATH };
export type { AgentPaneService };

/** Injects the backend `AgentPaneService` proxy in the frontend. */
export const AgentPaneServiceProxy = Symbol("AgentPaneServiceProxy");

/**
 * The client registered on the agent pane's RPC proxy: the backend pushes the
 * followed session's snapshots and deltas here, and the pane subscribes.
 */
@injectable()
export class AgentPaneClientDispatcher implements AgentPaneClient {
  private readonly snapshots = new Emitter<AgentPaneSnapshot>();
  readonly onSnapshot$: Event<AgentPaneSnapshot> = this.snapshots.event;

  private readonly deltas = new Emitter<AgentPaneDelta>();
  readonly onDelta$: Event<AgentPaneDelta> = this.deltas.event;

  private readonly adopted = new Emitter<{ from: string; to: string }>();
  readonly onSessionAdopted$: Event<{ from: string; to: string }> = this.adopted.event;

  onSnapshot(snapshot: AgentPaneSnapshot): void {
    this.snapshots.fire(snapshot);
  }

  onDelta(delta: AgentPaneDelta): void {
    this.deltas.fire(delta);
  }

  onSessionAdopted(from: string, to: string): void {
    this.adopted.fire({ from, to });
  }
}
