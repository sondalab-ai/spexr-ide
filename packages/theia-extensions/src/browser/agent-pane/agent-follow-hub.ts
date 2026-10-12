import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { AgentPaneSnapshot } from "../../common/agent-pane-protocol.js";

/** A session to look at, and the folder Claude ran it in (where its transcript lives). */
export interface ViewRequest {
  readonly sessionId: string;
  readonly projectPath: string;
}

/** What the agent pane follows right now, as the others read it. */
export interface FollowState {
  /** The session the pane follows: the agent's own, or the one the Sessions part pointed it at. */
  readonly followed: string | undefined;
  /** True when `followed` is a session chosen in the Sessions part, not the agent terminal's own. */
  readonly viewing: boolean;
  readonly snapshot: AgentPaneSnapshot | undefined;
}

/**
 * The seam between the agent pane and what sits around it: the Sessions part
 * (which points the pane at a session), the Agent log and the status bar's
 * model item (which read what it holds). The pane's widget owns the follow
 * (AgentPaneController) and publishes it here; nothing else touches the
 * controller. With no pane open nothing is published, and the readers show
 * their empty states.
 */
@injectable()
export class AgentFollowHub {
  private state: FollowState = { followed: undefined, viewing: false, snapshot: undefined };
  private readonly changed = new Emitter<FollowState>();
  private readonly requests = new Emitter<ViewRequest | undefined>();
  /** The last session asked for, kept for a pane that was not open when it was asked. */
  private requested: ViewRequest | undefined;

  readonly onDidChange: Event<FollowState> = this.changed.event;
  /** A request to follow a session read-only, or (undefined) to go back to the agent's own. */
  readonly onViewRequest: Event<ViewRequest | undefined> = this.requests.event;

  get current(): FollowState {
    return this.state;
  }

  /** The session asked for and not yet taken back: what a pane that opens now should follow. */
  get pendingView(): ViewRequest | undefined {
    return this.requested;
  }

  /** The pane's controller changed: say what it holds. */
  publish(next: FollowState): void {
    this.state = next;
    this.changed.fire(next);
  }

  /** The pane is gone: what was asked of it is not asked of the next one that opens. */
  clearPending(): void {
    this.requested = undefined;
  }

  /** Ask the pane to follow a session read-only, or its own session with undefined. */
  requestView(request: ViewRequest | undefined): void {
    this.requested = request;
    this.requests.fire(request);
  }
}
