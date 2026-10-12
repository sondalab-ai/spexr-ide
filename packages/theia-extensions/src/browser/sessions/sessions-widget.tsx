import * as React from "react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { CommandService } from "@theia/core/lib/common/command";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { AgentFollowHub } from "../agent-pane/agent-follow-hub.js";
import { AgentPaneViewContribution } from "../agent-pane/agent-pane-view-contribution.js";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import { SpexrAgentsCountService } from "../titlebar/agents-count-service.js";
import { DARKFACTORY_OPEN_COMMAND, DARKFACTORY_OPEN_SESSION_COMMAND } from "../darkfactory/darkfactory-open-session.js";
import { focusTarget, sessionRows, viewTarget, type SessionRow } from "./sessions-model.js";

/** How often the ages in the rows are written again: they move by the minute. */
const AGE_REFRESH_MS = 60_000;

export const SESSIONS_VIEW_ID = "spexr.view.sessions";

/**
 * The Sessions part of the Explorer: this workspace's agent sessions, each as
 * a name over `state · age · n tools`. A click, or an arrow key, points the
 * agent pane at that session, read-only (AgentFollowHub); the agent's own
 * session is the one that can be typed into. The selected row is the one the
 * pane follows. Rows come from Dark Factory's scan (SpexrAgentsCountService).
 */
@injectable()
export class SessionsWidget extends ReactWidget {
  static readonly ID = SESSIONS_VIEW_ID;

  @inject(SpexrAgentsCountService) private readonly agents!: SpexrAgentsCountService;
  @inject(AgentFollowHub) private readonly hub!: AgentFollowHub;
  @inject(AgentPaneViewContribution) private readonly paneView!: AgentPaneViewContribution;
  @inject(ClaudeTerminalManager) private readonly terminal!: ClaudeTerminalManager;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(CommandService) private readonly commands!: CommandService;

  private ticker: ReturnType<typeof setInterval> | undefined;
  /** The row buttons by session id, for moving focus without searching the DOM. */
  private readonly buttons = new Map<string, HTMLButtonElement>();

  constructor() {
    super();
    this.id = SessionsWidget.ID;
    this.title.label = nls.localize("spexr/sessions/title", "Sessions");
    this.title.caption = nls.localize("spexr/sessions/caption", "This workspace's agent sessions");
    this.title.closable = false;
    this.addClass("spexr-sessions-widget");
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.agents.onDidScan(() => this.update()));
    this.toDispose.push(this.hub.onDidChange(() => this.update()));
    this.toDispose.push(this.terminal.onDidChangeSession(() => this.update()));
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.update()));
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.ticker = setInterval(() => this.update(), AGE_REFRESH_MS);
  }

  protected override onBeforeDetach(msg: Message): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = undefined;
    super.onBeforeDetach(msg);
  }

  private rows(): { rows: SessionRow[]; more: number } {
    const roots = this.workspace.tryGetRoots().map((r) => r.resource.path.fsPath());
    const { followed, snapshot } = this.hub.current;
    return sessionRows(this.agents.tiles(), roots, Date.now(), followed, followed && snapshot?.sessionId === followed ? { sessionId: followed, title: snapshot.title } : undefined);
  }

  /**
   * Follow a session: a Claude session points the agent pane at it (read-only,
   * opening the pane when it is closed); a session of another CLI cannot be
   * followed there, so it opens on the wall as its tile does.
   */
  private select(row: SessionRow): void {
    if (row.harness !== "claude") {
      void this.commands.executeCommand(DARKFACTORY_OPEN_SESSION_COMMAND.id, row.sessionId);
      return;
    }
    this.hub.requestView(viewTarget(row, this.terminal.currentSessionId()));
    void this.paneView.openView({ activate: false, reveal: true });
  }

  /** Arrow keys, Home and End move focus between the rows; Enter or a click is what follows. */
  private onKeyDown(event: React.KeyboardEvent, rows: readonly SessionRow[]): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const current = rows.find((r) => this.buttons.get(r.sessionId) === document.activeElement)?.sessionId;
    const next = focusTarget(rows, current, event.key);
    if (next) this.buttons.get(next)?.focus();
  }

  protected render(): React.ReactNode {
    const { rows, more } = this.rows();
    const selected = this.hub.current.followed;
    if (rows.length === 0) {
      return <p className="spexr-sessions__empty">{nls.localize("spexr/sessions/empty", "No sessions in this workspace yet.")}</p>;
    }
    // One tab stop for the list: the selected row, or the first when none is.
    const stop = rows.some((r) => r.sessionId === selected) ? selected : rows[0]!.sessionId;
    return (
      <>
      <div className="sl-list spexr-sessions" role="listbox" aria-label={nls.localize("spexr/sessions/title", "Sessions")} onKeyDown={(e) => this.onKeyDown(e, rows)}>
        {rows.map((r) => (
          <button
            key={r.sessionId}
            ref={(el) => {
              if (el) this.buttons.set(r.sessionId, el);
              else this.buttons.delete(r.sessionId);
            }}
            type="button"
            className="sl-list__row spexr-sessions__row"
            role="option"
            aria-selected={r.sessionId === selected}
            tabIndex={r.sessionId === stop ? 0 : -1}
            data-state={r.state}
            onClick={() => this.select(r)}
          >
            <span className="spexr-sessions__name">{r.name}</span>
            <span className="sl-list__meta spexr-sessions__meta">{r.meta}</span>
          </button>
        ))}
      </div>
      {more > 0 ? (
        <button type="button" className="spexr-sessions__more" onClick={() => void this.commands.executeCommand(DARKFACTORY_OPEN_COMMAND.id)}>
          {nls.localize("spexr/sessions/more", "{0} more in the Agents wall", more)}
        </button>
      ) : null}
      </>
    );
  }
}
