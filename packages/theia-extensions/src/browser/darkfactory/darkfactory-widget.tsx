import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { ClipboardService } from "@theia/core/lib/browser/clipboard-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileUri } from "@theia/core/lib/common/file-uri";
import type { AgentSession, SpexrDarkfactoryService } from "../../common/darkfactory-protocol.js";
import { SpexrDarkfactoryServiceProxy } from "./darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "./darkfactory-client.js";
import { relativeTime, stateLabel, stateColor, groupByProject } from "./darkfactory-format.js";

/** Machine-wide overview of every Claude Code session ("agent"). */
@injectable()
export class SpexrDarkfactoryWidget extends ReactWidget {
  static readonly ID = "spexr.view.darkfactory";

  @inject(SpexrDarkfactoryServiceProxy) private readonly service!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly client!: SpexrDarkfactoryClientDispatcher;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(ClipboardService) private readonly clipboard!: ClipboardService;

  private agents: AgentSession[] = [];
  private readonly summaries = new Map<string, string>();

  @postConstruct()
  protected init(): void {
    this.id = SpexrDarkfactoryWidget.ID;
    this.title.label = "Darkfactory";
    this.title.caption = "All Claude agents at work";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-server-process";
    this.addClass("spexr-darkfactory");
    this.toDispose.push(this.client.onAgentsChanged$((agents) => this.setAgents(agents)));
    this.refresh().catch(() => { /* ignore */ });
  }

  private async refresh(): Promise<void> {
    this.setAgents(await this.service.listAgents());
  }

  private setAgents(agents: AgentSession[]): void {
    this.agents = agents;
    this.update();
    for (const a of agents) this.loadSummary(a).catch(() => { /* ignore */ });
  }

  private async loadSummary(a: AgentSession): Promise<void> {
    const s = await this.service.summarize(a.sessionId);
    this.summaries.set(a.sessionId, s.text);
    this.update();
  }

  protected render(): React.ReactNode {
    const now = Date.now();
    const groups = groupByProject(this.agents);
    if (groups.length === 0) {
      return (
        <div className="spexr-df-empty">
          No Claude agents found. Start a session to see it here.
        </div>
      );
    }
    return (
      <div className="spexr-df-root">
        {groups.map((g) => (
          <section className="spexr-df-group" key={g.projectPath}>
            <header className="spexr-df-group-head">
              <span className="spexr-df-project">{g.projectName}</span>
              <code className="spexr-df-path">{g.projectPath}</code>
              <span className="spexr-df-actions">
                <button
                  className="spexr-button spexr-button--primary"
                  onClick={() => this.openInSpexr(g.projectPath).catch(() => { /* ignore */ })}
                >
                  Open in SPEXR
                </button>
                <button
                  className="spexr-button"
                  onClick={() => this.service.revealInFileManager(g.projectPath).catch(() => { /* ignore */ })}
                >
                  Reveal
                </button>
                <button className="spexr-button" onClick={() => void this.clipboard.writeText(g.projectPath)}>
                  Copy path
                </button>
              </span>
            </header>
            {g.sessions.map((a) => (
              <article className="spexr-df-card" key={a.sessionId}>
                <span
                  className="spexr-df-led"
                  data-state={a.state}
                  style={{ background: stateColor(a.state) }}
                  title={stateLabel(a.state)}
                />
                {a.gitBranch && <span className="spexr-df-branch">{a.gitBranch}</span>}
                <span className="spexr-df-summary">{this.summaries.get(a.sessionId) ?? a.lastPrompt}</span>
                <span className="spexr-df-meta">
                  {a.mode && <em>{a.mode}</em>}
                  {a.permissionMode && <em>{a.permissionMode}</em>}
                  <time>{relativeTime(a.lastActivityMs, now)}</time>
                </span>
              </article>
            ))}
          </section>
        ))}
      </div>
    );
  }

  private async openInSpexr(projectPath: string): Promise<void> {
    this.workspace.open(FileUri.create(projectPath));
  }
}
