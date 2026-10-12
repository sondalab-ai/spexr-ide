import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { MessageService } from "@theia/core/lib/common/message-service";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import type { AgentPaneService } from "../../common/agent-pane-protocol.js";
import { AgentPaneClientDispatcher, AgentPaneServiceProxy } from "../agent/agent-pane-client.js";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import { AGENT_PANE_VIEW_ID } from "./agent-pane-view-contribution.js";
import { AgentPaneController } from "./agent-pane-controller.js";
import { AgentFollowHub } from "./agent-follow-hub.js";
import { DARKFACTORY_OPEN_SESSION_COMMAND } from "../darkfactory/darkfactory-open-session.js";
import { AgentPaneView } from "./agent-pane-view.js";

/**
 * The agent pane (read-only): what the followed Claude session is doing, as
 * the backend's AgentPaneService reports it. The session is the one the agent
 * terminal was started with (`--session-id`); the pane follows it from the
 * moment it is known, follows it to its successor after /clear or /resume,
 * and has an empty state while there is none. Updates arrive per transcript
 * record, so the pane moves in steps, not token by token.
 */
@injectable()
export class AgentPaneWidget extends ReactWidget {
  static readonly ID = AGENT_PANE_VIEW_ID;

  @inject(AgentPaneServiceProxy) private readonly service!: AgentPaneService;
  @inject(AgentPaneClientDispatcher) private readonly client!: AgentPaneClientDispatcher;
  @inject(ClaudeTerminalManager) private readonly terminal!: ClaudeTerminalManager;
  @inject(MessageService) private readonly messages!: MessageService;
  @inject(AgentFollowHub) private readonly hub!: AgentFollowHub;
  @inject(CommandService) private readonly commands!: CommandService;

  /** Which session the pane follows and what it holds of it: see AgentPaneController. */
  private controller!: AgentPaneController;
  constructor() {
    super();
    this.id = AgentPaneWidget.ID;
    this.title.label = nls.localize("spexr/agentPane/title", "Agent");
    this.title.caption = nls.localize("spexr/agentPane/caption", "What the agent is doing");
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-sparkle";
    this.addClass("spexr-agent-pane-widget");
  }

  @postConstruct()
  protected init(): void {
    this.controller = new AgentPaneController(
      this.service,
      this.terminal,
      (rootUri) => new URI(rootUri).path.fsPath(),
      () => {
        this.update();
        this.publish();
      },
      (message, error) => console.warn(`[spexr] ${message}`, error),
    );
    this.toDispose.push(this.hub.onViewRequest((req) => void this.controller.view(req?.sessionId, req?.projectPath)));
    this.toDispose.push(this.client.onSnapshot$((s) => this.controller.snapshotPushed(s)));
    this.toDispose.push(this.client.onDelta$((d) => this.controller.deltaPushed(d)));
    this.toDispose.push(this.client.onSessionAdopted$(({ from, to }) => this.controller.adopted(from, to)));
    this.toDispose.push(
      this.terminal.onDidChangeSession(() => {
        // A new agent session is what the pane shows again, whatever it was looking at.
        this.hub.requestView(undefined);
      }),
    );
    this.toDispose.push({
      dispose: () => {
        this.controller.dispose();
        this.hub.clearPending();
        this.hub.publish({ followed: undefined, viewing: false, snapshot: undefined });
      },
    });
    // Opened by a click in the Sessions part: it follows that session from the start.
    void this.controller.view(this.hub.pendingView?.sessionId, this.hub.pendingView?.projectPath);
  }

  /** Say what the pane follows, for the Sessions part, the Agent log and the status bar. */
  private publish(): void {
    this.hub.publish({ followed: this.controller.followed, viewing: this.controller.viewing !== undefined, snapshot: this.controller.snapshot });
  }

  /**
   * "Open in terminal" for a session that is not the agent's:
   * Dark Factory's own flow opens it (a resume in a card, or a read-only
   * follow with Fork when it runs elsewhere). Nothing starts in a workspace
   * that is not trusted.
   */
  private async openFollowedInTerminal(): Promise<void> {
    const id = this.controller.followed;
    if (!id) return;
    if (!(await this.terminal.isTrusted())) {
      this.messages.info(nls.localize("spexr/agentPane/trustResume", "Trust this workspace to open a session in a terminal."));
      return;
    }
    await this.commands.executeCommand(DARKFACTORY_OPEN_SESSION_COMMAND.id, id);
  }

  /** A follow that failed is tried again whenever the pane comes into view. */
  protected override onAfterShow(msg: Message): void {
    super.onAfterShow(msg);
    void this.controller.bind();
  }

  protected render(): React.ReactNode {
    const snapshot = this.controller.snapshot;
    // "Waiting for you in the terminal" is about the agent's terminal: another session's wait is not asked of it.
    const shown = snapshot && this.controller.viewing !== undefined && snapshot.needsYou ? { ...snapshot, needsYou: false } : snapshot;
    return (
      <AgentPaneView
        snapshot={shown}
        loading={snapshot === undefined && this.controller.loading}
        expanded={this.controller.expanded}
        onToggleExpanded={() => this.controller.toggleExpanded()}
        onReveal={() => void (this.controller.viewing === undefined ? this.terminal.reveal() : this.openFollowedInTerminal())}
      />
    );
  }
}
