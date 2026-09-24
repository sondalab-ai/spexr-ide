import * as React from "react";
import { injectable, inject, optional, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type FileOperationEvent } from "@theia/filesystem/lib/common/files";
import { nls } from "@theia/core/lib/common/nls";
import type URI from "@theia/core/lib/common/uri";
import { EXPERTS_VIEW_ID } from "./experts-view-contribution.js";
import { SpexrCommands } from "../commands/spexr-commands-contribution.js";
import { SpexrAgentServiceProxy } from "../agent/agent-service-proxy.js";
import type { SpexrAgentService, ExpertAgentDto } from "../../common/agent-protocol.js";
import { mergeInstalled, parseExpertFrontmatter, type InstalledExpert, type InstalledExpertMeta } from "./experts-format.js";
import { SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE } from "../preferences/spexr-preferences.js";
import { agentsDir } from "../workspace-paths.js";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";

interface ExpertsPanelProps {
  readonly hasWorkspace: boolean;
  readonly marketplace: readonly ExpertAgentDto[];
  readonly installed: readonly InstalledExpert[];
  /** Whether the workspace has several folders, so each expert says where it is installed. */
  readonly multiRoot: boolean;
  readonly activeId: string | undefined;
  readonly onAdd: (expert: ExpertAgentDto) => void;
  readonly onRemove: (id: string) => void;
  readonly onStart: (expert: ExpertAgentDto) => void;
  readonly onKickoff: (expert: ExpertAgentDto) => void;
  readonly onDeactivate: () => void;
  readonly onRefresh: () => void;
}

@injectable()
export class SpexrExpertsWidget extends ReactWidget {
  static readonly ID = EXPERTS_VIEW_ID;

  @inject(CommandService)
  private readonly commands!: CommandService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  @inject(ClaudeTerminalManager)
  private readonly claudeTerminal!: ClaudeTerminalManager;

  @optional()
  @inject(SpexrAgentServiceProxy)
  private readonly agentService!: SpexrAgentService | undefined;

  private marketplace: readonly ExpertAgentDto[] = [];
  private installed: readonly InstalledExpert[] = [];

  constructor() {
    super();
    this.id = SpexrExpertsWidget.ID;
    this.title.label = nls.localize("spexr/experts/title", "Experts");
    this.title.caption = "Expert agents marketplace";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-organization";
    this.addClass("spexr-experts-widget");
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.refresh()));
    this.toDispose.push(
      this.fileService.onDidRunOperation((event) => {
        if (this.affectsAgents(event)) void this.refresh();
      }),
    );
    this.toDispose.push(
      this.preferences.onPreferenceChanged((e) => {
        if (e.preferenceName === SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE) this.update();
      }),
    );
    void this.refresh();
    this.update();
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.update();
  }

  private affectsAgents(event: FileOperationEvent): boolean {
    const agentsRoots = this.workspaceRoots().map((root) => agentsDir(root).toString() + "/");
    const candidates = [event.resource, event.target?.resource].filter(
      (u): u is URI => u !== undefined,
    );
    return candidates.some(
      (uri) =>
        uri.path.base.endsWith(".md") && agentsRoots.some((dir) => uri.toString().startsWith(dir)),
    );
  }

  private async refresh(): Promise<void> {
    this.marketplace = this.agentService ? await this.safeMarketplace() : [];
    this.installed = await this.loadInstalled();
    this.update();
  }

  private async safeMarketplace(): Promise<readonly ExpertAgentDto[]> {
    try {
      return await this.agentService!.listMarketplaceExperts();
    } catch {
      return [];
    }
  }

  /** Experts installed in any workspace folder, each with the folders that have it. */
  private async loadInstalled(): Promise<readonly InstalledExpert[]> {
    const roots = this.workspaceRoots();
    const perFolder = await Promise.all(
      roots.map(async (root) => ({ folder: root.path.base, experts: await this.loadInstalledIn(root) })),
    );
    return mergeInstalled(perFolder);
  }

  private async loadInstalledIn(root: URI): Promise<readonly InstalledExpertMeta[]> {
    try {
      const stat = await this.fileService.resolve(agentsDir(root));
      const items: InstalledExpertMeta[] = [];
      for (const child of stat.children ?? []) {
        if (!child.isFile || !child.name.endsWith(".md")) continue;
        try {
          const file = await this.fileService.read(child.resource);
          const meta = parseExpertFrontmatter(file.value, child.name.replace(/\.md$/, ""));
          if (meta) items.push(meta);
        } catch {
          // skip unreadable file
        }
      }
      return items.sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  private workspaceRoots(): URI[] {
    return this.workspace.tryGetRoots().map((root) => root.resource);
  }

  /** The expert active in the folder the agent runs in. */
  private activeId(): string | undefined {
    return this.claudeTerminal.activeExpertId();
  }

  private readonly handleAdd = (expert: ExpertAgentDto): void => {
    void this.commands
      .executeCommand(SpexrCommands.EXPERT_ADD.id, expert)
      .then(() => this.refresh());
  };

  private readonly handleRemove = (id: string): void => {
    void this.commands
      .executeCommand(SpexrCommands.EXPERT_REMOVE.id, id)
      .then(() => this.refresh());
  };

  private readonly handleStart = (expert: ExpertAgentDto): void => {
    void this.commands.executeCommand(SpexrCommands.EXPERT_START.id, expert).then(() => this.update());
  };

  private readonly handleKickoff = (expert: ExpertAgentDto): void => {
    void this.commands.executeCommand(SpexrCommands.EXPERT_KICKOFF.id, expert);
  };

  private readonly handleDeactivate = (): void => {
    void this.commands.executeCommand(SpexrCommands.EXPERT_DEACTIVATE.id).then(() => this.update());
  };

  private readonly handleRefresh = (): void => {
    void this.refresh();
  };

  protected render(): React.ReactNode {
    return (
      <ExpertsPanel
        hasWorkspace={this.workspaceRoots().length > 0}
        marketplace={this.marketplace}
        installed={this.installed}
        multiRoot={this.workspaceRoots().length > 1}
        activeId={this.activeId()}
        onAdd={this.handleAdd}
        onRemove={this.handleRemove}
        onStart={this.handleStart}
        onKickoff={this.handleKickoff}
        onDeactivate={this.handleDeactivate}
        onRefresh={this.handleRefresh}
      />
    );
  }
}

const ExpertsPanel: React.FC<ExpertsPanelProps> = ({
  hasWorkspace,
  marketplace,
  installed,
  multiRoot,
  activeId,
  onAdd,
  onRemove,
  onStart,
  onKickoff,
  onDeactivate,
  onRefresh,
}) => {
  const installedIds = new Set(installed.map((e) => e.id));
  const available = marketplace.filter((e) => !installedIds.has(e.id));
  const dtoById = new Map(marketplace.map((e) => [e.id, e]));

  if (!hasWorkspace) {
    return (
      <section className="spexr-experts-panel" aria-label="Expert agents">
        <p className="spexr-experts-panel__empty">Open a workspace to manage expert agents.</p>
      </section>
    );
  }

  return (
    <section className="spexr-experts-panel" aria-label="Expert agents">
      <header className="spexr-experts-panel__header">
        <h2>{nls.localize("spexr/experts/title", "Experts")}</h2>
        <p className="spexr-experts-panel__hint">
          Add an expert persona to the project, then start a Claude session as that expert.
          One expert is active at a time.
        </p>
      </header>

      <div className="spexr-experts-panel__actions">
        <button type="button" className="spexr-button" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <div className="spexr-experts-panel__section">
        <h3 className="spexr-experts-panel__subtitle">{nls.localize("spexr/experts/inProject", "In project")}</h3>
        {installed.length === 0 ? (
          <p className="spexr-experts-panel__empty">
            No experts yet. Add one from the marketplace below.
          </p>
        ) : (
          <ul className="spexr-experts-list" role="list">
            {installed.map((e) => {
              const isActive = e.id === activeId;
              const dto = dtoById.get(e.id);
              return (
                <li
                  key={e.id}
                  className={`spexr-experts-list__item${isActive ? " spexr-experts-list__item--active" : ""}`}
                  style={isActive ? { borderColor: e.color, background: `${e.color}1f` } : undefined}
                >
                  <span className={`codicon ${e.icon} spexr-experts-list__icon`} style={{ color: e.color }} />
                  <span className="spexr-experts-list__meta">
                    <span className="spexr-experts-list__name">
                      {e.name}
                      {isActive ? (
                        <span
                          className="spexr-experts-list__status"
                          role="img"
                          aria-label={nls.localize("spexr/experts/activeStatus", "Active: the agent runs as this expert")}
                          title={nls.localize("spexr/experts/activeStatus", "Active: the agent runs as this expert")}
                        />
                      ) : null}
                    </span>
                    {dto?.description ? (
                      <span className="spexr-experts-list__desc">{dto.description}</span>
                    ) : null}
                    {multiRoot ? (
                      <span className="spexr-experts-list__desc">in {e.folders.join(", ")}</span>
                    ) : null}
                  </span>
                  <span className="spexr-experts-list__buttons">
                    {dto && !isActive ? (
                      <button
                        type="button"
                        className="spexr-button spexr-button--compact"
                        onClick={() => onStart(dto)}
                      >
                        {nls.localize("spexr/experts/start", "Start")}
                      </button>
                    ) : null}
                    {isActive && dto?.kickoffPrompt ? (
                      <button
                        type="button"
                        className="spexr-button spexr-button--compact"
                        onClick={() => onKickoff(dto)}
                        title={nls.localize(
                          "spexr/experts/kickoffHint",
                          "Re-run this expert's kickoff prompt",
                        )}
                      >
                        {nls.localize("spexr/experts/kickoff", "Run kickoff")}
                      </button>
                    ) : null}
                    {isActive ? (
                      <button
                        type="button"
                        className="spexr-button spexr-button--compact"
                        onClick={onDeactivate}
                      >
                        {nls.localize("spexr/experts/deactivate", "Deactivate")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="spexr-button spexr-button--ghost spexr-button--compact spexr-button--danger"
                      onClick={() => onRemove(e.id)}
                    >
                      {nls.localize("spexr/experts/remove", "Remove")}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="spexr-experts-panel__section">
        <h3 className="spexr-experts-panel__subtitle">Marketplace</h3>
        {available.length === 0 ? (
          <p className="spexr-experts-panel__empty">All marketplace experts are already in the project.</p>
        ) : (
          <ul className="spexr-experts-list" role="list">
            {available.map((e) => (
              <li key={e.id} className="spexr-experts-list__item">
                <span className={`codicon ${e.icon} spexr-experts-list__icon`} style={{ color: e.color }} />
                <span className="spexr-experts-list__meta">
                  <span className="spexr-experts-list__name">{e.name}</span>
                  <span className="spexr-experts-list__desc">{e.description}</span>
                </span>
                <span className="spexr-experts-list__buttons">
                  <button
                    type="button"
                    className="spexr-button spexr-button--compact"
                    onClick={() => onAdd(e)}
                  >
                    {nls.localize("spexr/experts/add", "+ Add")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
