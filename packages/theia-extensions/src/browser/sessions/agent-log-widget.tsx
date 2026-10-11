import * as React from "react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import type { AgentPaneService } from "../../common/agent-pane-protocol.js";
import type { FollowEvent } from "../../common/darkfactory-protocol.js";
import { AgentPaneServiceProxy } from "../agent/agent-pane-client.js";
import { AgentFollowHub } from "../agent-pane/agent-follow-hub.js";
import { FollowTranscript } from "../darkfactory/agent-tile.js";

export const AGENT_LOG_VIEW_ID = "spexr.view.agent-log";

/** How long after a change the log is read again: a turn writes in bursts. */
const READ_DEBOUNCE_MS = 250;
/** Within this many px of the end the log follows new lines; further up the reader is reading and is left alone. */
const STICK_PX = 24;
/** A failed read is tried again this many times, each after a longer wait. */
const MAX_RETRIES = 3;
const READ_RETRY_MS = 1000;

/**
 * The Agent log, in the bottom panel: every event of the session the agent
 * pane follows, each with the time it was written. It reads the same
 * transcript as the pane (AgentPaneService.readLog) and renders it with the
 * Darkfactory follow's lines (FollowTranscript), so a prompt, a reply, a tool
 * call and its result look as they do on the wall.
 */
@injectable()
export class AgentLogWidget extends ReactWidget {
  static readonly ID = AGENT_LOG_VIEW_ID;

  @inject(AgentPaneServiceProxy) private readonly service!: AgentPaneService;
  @inject(AgentFollowHub) private readonly hub!: AgentFollowHub;

  private events: FollowEvent[] = [];
  /** The session `events` are of. */
  private eventsOf: string | undefined;
  /** What the last read was for: the session and its last entry time; a push that changes neither is not read again. */
  private readFor: string | undefined;
  /** A change came while the tab was hidden: it is read when the tab is shown. */
  private stale = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retries = 0;
  private endTimers: Array<ReturnType<typeof setTimeout>> = [];
  private reads = 0;
  private stick = true;
  private readonly scroller = React.createRef<HTMLDivElement>();

  constructor() {
    super();
    this.id = AgentLogWidget.ID;
    this.title.label = nls.localize("spexr/agentLog/title", "Agent log");
    this.title.caption = nls.localize("spexr/agentLog/caption", "Events of the session the agent pane follows");
    this.title.closable = false;
    this.title.iconClass = "codicon codicon-output";
    this.addClass("spexr-agent-log-widget");
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.hub.onDidChange(() => this.schedule()));
    this.toDispose.push({
      dispose: () => {
        clearTimeout(this.timer);
        for (const t of this.endTimers) clearTimeout(t);
        this.endTimers = [];
        this.reads++;
      },
    });
    this.schedule();
  }

  /**
   * Read the followed session's events after a pause when something changed:
   * another session, or more written to it. Not while the tab is hidden (it
   * is read when shown), and the lines of the session left are dropped at once,
   * never shown under the new one's name.
   */
  private schedule(): void {
    const { followed, snapshot } = this.hub.current;
    if (followed !== this.eventsOf && this.events.length > 0) {
      this.events = [];
      this.update();
    }
    const key = followed ? `${followed}@${snapshot?.updatedAtMs ?? 0}:${snapshot?.toolCount ?? 0}` : undefined;
    if (key === this.readFor) return;
    this.readFor = key;
    clearTimeout(this.timer);
    this.retries = 0;
    if (!followed) {
      this.reads++;
      this.eventsOf = undefined;
      this.update();
      return;
    }
    if (!this.isVisible) {
      this.stale = true;
      return;
    }
    this.timer = setTimeout(() => void this.read(followed), READ_DEBOUNCE_MS);
  }

  private async read(followed: string): Promise<void> {
    const mine = ++this.reads;
    const events = await this.service.readLog(followed).catch(() => undefined);
    // A newer read, or another session, took over while this one waited.
    if (mine !== this.reads || this.hub.current.followed !== followed) return;
    if (!events) {
      // A failed read is tried again a few times, a little later each time.
      if (this.retries < MAX_RETRIES) this.timer = setTimeout(() => void this.read(followed), READ_RETRY_MS * ++this.retries);
      return;
    }
    this.retries = 0;
    this.events = events;
    this.eventsOf = followed;
    this.update();
  }

  /** Follow the end: the log may have been read while its tab was hidden, when nothing can scroll. */
  private toEnd(): void {
    const el = this.scroller.current;
    if (el && this.stick) el.scrollTop = el.scrollHeight;
  }

  private followEnd(): void {
    for (const t of this.endTimers) clearTimeout(t);
    // After React has committed and laid the lines out: two frames on, and once more after a pause.
    this.endTimers = [setTimeout(() => this.toEnd(), 100)];
    requestAnimationFrame(() => requestAnimationFrame(() => this.toEnd()));
  }

  protected override onUpdateRequest(msg: Parameters<ReactWidget["onUpdateRequest"]>[0]): void {
    super.onUpdateRequest(msg);
    this.followEnd();
  }

  protected override onAfterShow(msg: Parameters<ReactWidget["onAfterShow"]>[0]): void {
    super.onAfterShow(msg);
    if (this.stale) {
      this.stale = false;
      this.readFor = undefined;
      this.schedule();
    }
    this.followEnd();
  }

  protected render(): React.ReactNode {
    return (
      <div
        ref={this.scroller}
        className="spexr-agent-log"
        onScroll={(e) => {
          const el = e.currentTarget;
          this.stick = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
        }}
      >
        {this.hub.current.followed ? (
          <FollowTranscript events={this.events} showTime />
        ) : (
          <div className="spexr-df-term spexr-df-term--empty">{nls.localize("spexr/agentLog/none", "No session is being followed. Open the agent pane or pick a session.")}</div>
        )}
      </div>
    );
  }
}
