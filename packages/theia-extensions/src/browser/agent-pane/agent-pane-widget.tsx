import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import { applyDelta } from "../../common/agent-pane-apply.js";
import type { AgentPaneService, AgentPaneSnapshot } from "../../common/agent-pane-protocol.js";
import { AgentPaneClientDispatcher, AgentPaneServiceProxy } from "../agent/agent-pane-client.js";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import { AGENT_PANE_VIEW_ID } from "./agent-pane-view-contribution.js";
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

  private snapshot: AgentPaneSnapshot | undefined;
  /** The session the backend is asked to follow; deltas and snapshots of any other are late and dropped. */
  private followed: string | undefined;
  private expanded = false;

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
    this.toDispose.push(
      this.client.onSnapshot$((s) => {
        if (s.sessionId !== this.followed) return;
        this.snapshot = s;
        this.update();
      }),
    );
    this.toDispose.push(
      this.client.onDelta$((d) => {
        if (d.sessionId !== this.followed || !this.snapshot) return;
        this.snapshot = applyDelta(this.snapshot, d);
        this.update();
      }),
    );
    this.toDispose.push(
      this.client.onSessionAdopted$(({ from, to }) => {
        if (from !== this.followed) return;
        this.followed = to;
        // The conversation moved on (/clear, /resume): it is the agent's session now, and a reload follows it.
        const root = this.terminal.agentRootUri();
        if (root) this.terminal.adoptSessionId(root, to);
        this.snapshot = undefined;
        this.update();
      }),
    );
    this.toDispose.push(this.terminal.onDidChangeSession(() => void this.bind()));
    this.toDispose.push({ dispose: () => void this.service.stop().catch(() => undefined) });
    void this.bind();
  }

  /** Follow the agent terminal's session, or show the empty state when it has none. */
  private async bind(): Promise<void> {
    const rootUri = this.terminal.agentRootUri();
    const running = this.terminal.currentSessionId();
    const sessionId = running ?? (rootUri ? await this.terminal.storedSessionId(rootUri) : undefined);
    if (!rootUri || !sessionId) {
      this.followed = undefined;
      this.snapshot = undefined;
      this.update();
      await this.service.stop().catch(() => undefined);
      return;
    }
    if (sessionId === this.followed) return;
    this.followed = sessionId;
    this.snapshot = undefined;
    this.update();
    try {
      const first = await this.service.follow({
        sessionId,
        workspacePath: new URI(rootUri).path.fsPath(),
        // An id from storage may be a session that ended: the backend then adopts a newer transcript only while a Claude runs there.
        ...(running ? {} : { fromStorage: true }),
      });
      if (first && this.followed === sessionId && !this.snapshot) {
        this.snapshot = first;
        this.update();
      }
    } catch (err) {
      console.warn("[spexr] the agent pane could not follow its session", err);
    }
  }

  protected render(): React.ReactNode {
    return (
      <AgentPaneView
        snapshot={this.snapshot}
        expanded={this.expanded}
        onToggleExpanded={() => {
          this.expanded = !this.expanded;
          this.update();
        }}
        onReveal={() => void this.terminal.reveal()}
      />
    );
  }
}
