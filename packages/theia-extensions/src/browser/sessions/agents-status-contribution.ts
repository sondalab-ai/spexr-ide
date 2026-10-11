import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { nls } from "@theia/core/lib/common/nls";
import { STALE_MS } from "../../common/session-timing.js";
import { AgentFollowHub } from "../agent-pane/agent-follow-hub.js";
import { statusClass } from "../shell/status-dock.js";
import { AgentTilesFeed } from "./agent-tiles-feed.js";
import { agentsPill, modelItem } from "./sessions-model.js";

const PILL_ID = "spexr-agents-pill";
const MODEL_ID = "spexr-agent-model";

/**
 * The status bar's two agent items. The pill, "● 2 agents · 212 tools", says
 * how many agents run (the title bar's count) and the tool calls those agents
 * have made; it is not drawn at 0. The model item, "✦ Opus · 86 tok/s", is
 * the model and the rate of the latest completed reply of the session the
 * agent pane follows; it is not drawn without one, or when the transcript has
 * been silent for longer than a working session may be (the rate is then
 * not what the agent does now).
 */
@injectable()
export class SpexrAgentsStatusContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(AgentTilesFeed) private readonly feed!: AgentTilesFeed;
  @inject(AgentFollowHub) private readonly hub!: AgentFollowHub;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;

  onStart(): void {
    this.feed.onDidChange(() => this.renderPill());
    this.hub.onDidChange(() => this.renderModel());
    this.feed.start();
    this.renderPill();
    this.renderModel();
  }

  onStop(): void {
    clearTimeout(this.staleTimer);
  }

  private renderPill(): void {
    const pill = agentsPill(this.feed.live());
    if (!pill) {
      this.statusBar.removeElement(PILL_ID);
      return;
    }
    void this.statusBar.setElement(PILL_ID, {
      text: pill.text,
      className: statusClass({ live: true, agents: true }),
      alignment: StatusBarAlignment.LEFT,
      priority: 5,
      tooltip: nls.localize("spexr/sessions/pillTip", "Agents working now, and the tool calls they have made"),
    });
  }

  private renderModel(): void {
    clearTimeout(this.staleTimer);
    const snapshot = this.hub.current.snapshot;
    const item = modelItem(snapshot, Date.now());
    if (!item) {
      this.statusBar.removeElement(MODEL_ID);
      return;
    }
    void this.statusBar.setElement(MODEL_ID, {
      text: `$(sparkle) ${item.text}`,
      className: statusClass({ data: true }),
      alignment: StatusBarAlignment.RIGHT,
      priority: 1000,
      tooltip: nls.localize("spexr/sessions/modelTip", "The model and its output rate on the latest reply"),
    });
    // A session that is not working keeps the item only while its last reply is recent: look again when it stops being.
    if (snapshot?.state !== "working" && snapshot?.updatedAtMs !== undefined) {
      this.staleTimer = setTimeout(() => this.renderModel(), Math.max(1000, snapshot.updatedAtMs + STALE_MS - Date.now() + 1));
    }
  }
}
