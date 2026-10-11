import * as React from "react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { AgentFollowHub } from "../agent-pane/agent-follow-hub.js";
import { AgentPaneViewContribution } from "../agent-pane/agent-pane-view-contribution.js";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import { AgentTilesFeed } from "./agent-tiles-feed.js";
import { sessionRows, stepRow, viewTarget, type SessionRow } from "./sessions-model.js";

/** How often the ages in the rows are written again: they move by the minute. */
const AGE_REFRESH_MS = 60_000;

export const SESSIONS_VIEW_ID = "spexr.view.sessions";

/**
 * The Sessions part of the Explorer: this workspace's agent sessions, each as
 * a name over `state · age · n tools`. A click, or an arrow key, points the
 * agent pane at that session, read-only (AgentFollowHub); the agent's own
 * session is the one that can be typed into. The selected row is the one the
 * pane follows. Rows come from Dark Factory's scan (AgentTilesFeed).
 */
@injectable()
export class SessionsWidget extends ReactWidget {
  static readonly ID = SESSIONS_VIEW_ID;

  @inject(AgentTilesFeed) private readonly feed!: AgentTilesFeed;
  @inject(AgentFollowHub) private readonly hub!: AgentFollowHub;
  @inject(AgentPaneViewContribution) private readonly paneView!: AgentPaneViewContribution;
  @inject(ClaudeTerminalManager) private readonly terminal!: ClaudeTerminalManager;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;

  private ticker: ReturnType<typeof setInterval> | undefined;
  private readonly listRef = React.createRef<HTMLDivElement>();

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
    this.toDispose.push(this.feed.onDidChange(() => this.update()));
    this.toDispose.push(this.hub.onDidChange(() => this.update()));
    this.toDispose.push(this.terminal.onDidChangeSession(() => this.update()));
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.update()));
    this.feed.start();
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

  private rows(): SessionRow[] {
    const root = this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    const { followed, snapshot } = this.hub.current;
    return sessionRows(this.feed.tiles(), root, Date.now(), this.terminal.currentSessionId(), followed && snapshot?.sessionId === followed ? { sessionId: followed, title: snapshot.title } : undefined);
  }

  /** Point the agent pane at a session, opening the pane when it is closed. */
  private select(row: SessionRow): void {
    this.hub.requestView(viewTarget(row.sessionId, this.terminal.currentSessionId()));
    void this.paneView.openView({ activate: false, reveal: true });
  }

  private onKeyDown(event: React.KeyboardEvent, rows: readonly SessionRow[], selected: string | undefined): void {
    const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = stepRow(rows, selected, delta);
    const row = rows.find((r) => r.sessionId === next);
    if (!row || row.sessionId === selected) return;
    this.select(row);
    this.listRef.current?.querySelector<HTMLElement>(`[data-session-id="${row.sessionId}"]`)?.focus();
  }

  protected render(): React.ReactNode {
    const rows = this.rows();
    const selected = this.hub.current.followed;
    if (rows.length === 0) {
      return <p className="spexr-sessions__empty">{nls.localize("spexr/sessions/empty", "No sessions in this workspace yet.")}</p>;
    }
    // One tab stop for the list: the selected row, or the first when none is.
    const stop = rows.some((r) => r.sessionId === selected) ? selected : rows[0]!.sessionId;
    return (
      <div
        ref={this.listRef}
        className="sl-list spexr-sessions"
        role="listbox"
        aria-label={nls.localize("spexr/sessions/title", "Sessions")}
        onKeyDown={(e) => this.onKeyDown(e, rows, selected)}
      >
        {rows.map((r) => (
          <button
            key={r.sessionId}
            type="button"
            className="sl-list__row spexr-sessions__row"
            role="option"
            aria-selected={r.sessionId === selected}
            tabIndex={r.sessionId === stop ? 0 : -1}
            data-session-id={r.sessionId}
            data-state={r.state}
            onClick={() => this.select(r)}
          >
            <span className="spexr-sessions__name">{r.name}</span>
            <span className="sl-list__meta spexr-sessions__meta">{r.meta}</span>
          </button>
        ))}
      </div>
    );
  }
}
