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
  /** What the last read was for: the session and its last entry time; a push that changes neither is not read again. */
  private readFor: string | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
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
    this.toDispose.push({ dispose: () => clearTimeout(this.timer) });
    this.schedule();
  }

  private schedule(): void {
    const { followed, snapshot } = this.hub.current;
    const key = followed ? `${followed}@${snapshot?.updatedAtMs ?? 0}:${snapshot?.toolCount ?? 0}` : undefined;
    if (key === this.readFor) return;
    this.readFor = key;
    clearTimeout(this.timer);
    if (!followed) {
      this.reads++;
      this.events = [];
      this.update();
      return;
    }
    this.timer = setTimeout(() => void this.read(followed), READ_DEBOUNCE_MS);
  }

  private async read(followed: string): Promise<void> {
    const mine = ++this.reads;
    const events = await this.service.readLog().catch(() => undefined);
    // A newer read, or another session, took over while this one waited.
    if (mine !== this.reads || !events || this.hub.current.followed !== followed) return;
    this.events = events;
    this.update();
  }

  protected override onUpdateRequest(msg: Parameters<ReactWidget["onUpdateRequest"]>[0]): void {
    super.onUpdateRequest(msg);
    // After React has committed and laid the new lines out: two frames on.
    const toEnd = (): void => {
      const el = this.scroller.current;
      if (el && this.stick) el.scrollTop = el.scrollHeight;
    };
    requestAnimationFrame(() => requestAnimationFrame(toEnd));
    setTimeout(toEnd, 100);
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
        <FollowTranscript events={this.events} showTime />
      </div>
    );
  }
}
