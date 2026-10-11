import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { nls } from "@theia/core/lib/common/nls";
import { STALE_MS } from "../../common/session-timing.js";
import { AgentFollowHub } from "../agent-pane/agent-follow-hub.js";
import { statusClass } from "../shell/status-dock.js";
import { DARKFACTORY_OPEN_COMMAND } from "../darkfactory/darkfactory-open-session.js";
import { SpexrAgentsCountService } from "../titlebar/agents-count-service.js";
import { agentsPill, modelItem } from "./sessions-model.js";

const PILL_ID = "spexr-agents-pill";
const MODEL_ID = "spexr-agent-model";

/**
 * The status bar's two agent items. The pill, "● 2 agents · 212 tools", says
 * how many agents run (the window's one count, SpexrAgentsCountService) and the tool calls those agents
 * have made; it is not drawn at 0. The model item, "✦ Opus · 86 tok/s", is
 * the model and the rate of the latest completed reply of the session the
 * agent pane follows; it is not drawn without one, or when the transcript has
 * been silent for longer than a working session may be (the rate is then
 * not what the agent does now). The model item follows whatever session the
 * agent pane is viewing, so it is empty while the pane is closed. The pill
 * opens the Agents wall.
 */
@injectable()
export class SpexrAgentsStatusContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrAgentsCountService) private readonly agents!: SpexrAgentsCountService;
  @inject(AgentFollowHub) private readonly hub!: AgentFollowHub;
  /** What each item last said, so an unchanged scan or snapshot does not set the entry again. */
  private pillText: string | undefined;
  private modelText: string | undefined;
  private staleTimer: ReturnType<typeof setTimeout> | undefined;

  onStart(): void {
    this.agents.onDidScan(() => this.renderPill());
    this.hub.onDidChange(() => this.renderModel());
    this.renderPill();
    this.renderModel();
  }

  onStop(): void {
    clearTimeout(this.staleTimer);
  }

  private renderPill(): void {
    const pill = agentsPill(this.agents.live());
    if (!pill) {
      if (this.pillText !== undefined) this.statusBar.removeElement(PILL_ID);
      this.pillText = undefined;
      return;
    }
    if (pill.text === this.pillText) return;
    this.pillText = pill.text;
    void this.statusBar.setElement(PILL_ID, {
      command: DARKFACTORY_OPEN_COMMAND.id,
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
      if (this.modelText !== undefined) this.statusBar.removeElement(MODEL_ID);
      this.modelText = undefined;
      return;
    }
    if (item.text !== this.modelText) {
      this.modelText = item.text;
    void this.statusBar.setElement(MODEL_ID, {
      text: `$(sparkle) ${item.text}`,
      className: statusClass({ data: true }),
      alignment: StatusBarAlignment.RIGHT,
      priority: 1000,
      tooltip: nls.localize("spexr/sessions/modelTip", "The model and its output rate on the latest reply"),
    });
    }
    // A session that is not working keeps the item only while its last reply is recent: look again when it stops being.
    if (snapshot?.state !== "working" && snapshot?.updatedAtMs !== undefined) {
      this.staleTimer = setTimeout(() => this.renderModel(), Math.max(1000, snapshot.updatedAtMs + STALE_MS - Date.now() + 1));
    }
  }
}
