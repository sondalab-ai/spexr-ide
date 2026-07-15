import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type FileOperationEvent } from "@theia/filesystem/lib/common/files";
import type URI from "@theia/core/lib/common/uri";
import {
  computeEffectiveProgress,
  hasAuthoredAcceptanceCriteria,
  parseSpec,
  parseSpecPlan,
  WORKFLOW_STEP_ORDER,
  type DriftReport,
  type EffectiveWorkflowProgress,
  type PlanTask,
  type WorkflowStep,
} from "@spexr/spec";
import { SPEC_VIEW_ID } from "./spec-view-contribution.js";
import { SpexrCommands } from "../commands/spexr-commands-contribution.js";
import { allSpecsDirs, SPEC_CONTEXT_DIR } from "../workspace-paths.js";
import {
  SpecWorkflowStepper,
  WorkspaceProgressBar,
} from "./spec-workflow-stepper.js";

const SPEC_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/;
const SPEC_SLUG_RE = /^(\d{4}-[a-z0-9][a-z0-9-]*)\.md$/;

interface SpecEntry {
  readonly uri: string;
  readonly name: string;
  readonly title: string;
  readonly progress: EffectiveWorkflowProgress;
  readonly planTasks: readonly PlanTask[];
}

interface SpecPanelProps {
  readonly specs: readonly SpecEntry[];
  readonly hasWorkspace: boolean;
  readonly aggregatePercent: number;
  readonly onCreate: () => void;
  readonly onSendToAgent: (uri: string) => void;
  readonly onRetrospective: (uri: string) => void;
  readonly onOpen: (uri: string) => void;
  readonly onDelete: (uri: string) => void;
  readonly onRefresh: () => void;
  readonly onStepClick: (uri: string, step: WorkflowStep) => void;
  readonly onTaskToggle: (uri: string, taskId: string) => void;
  readonly onForceStep: (uri: string, step: WorkflowStep) => void;
  readonly onUnforceStep: (uri: string, step: WorkflowStep) => void;
}

@injectable()
export class SpexrSpecWidget extends ReactWidget {
  static readonly ID = SPEC_VIEW_ID;

  @inject(CommandService)
  private readonly commands!: CommandService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(FileService)
  private readonly fileService!: FileService;

  private specs: readonly SpecEntry[] = [];
  private aggregatePercent = 0;

  constructor() {
    super();
    this.id = SpexrSpecWidget.ID;
    this.title.label = "Spec";
    this.title.caption = "Active spec for this workspace";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-checklist";
    this.addClass("spexr-spec-widget");
    // Focusable so the shell can complete activation when this tab is selected;
    // without it Theia warns "did not accept focus" and the current/active
    // widget change events never fire.
    this.node.tabIndex = 0;
  }

  protected override onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    this.node.focus();
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.refreshSpecs()));
    this.toDispose.push(
      this.fileService.onDidRunOperation((event) => {
        if (this.affectsSpecs(event)) void this.refreshSpecs();
      }),
    );
    void this.refreshSpecs();
    this.update();
  }

  private affectsSpecs(event: FileOperationEvent): boolean {
    const root = this.workspaceRoot();
    if (!root) return false;
    const specsDirPrefixes = allSpecsDirs(root).map((d) => d.toString() + "/");
    const candidates = [event.resource, event.target?.resource].filter(
      (u): u is URI => u !== undefined,
    );
    return candidates.some((uri) =>
      specsDirPrefixes.some((prefix) => uri.toString().startsWith(prefix)),
    );
  }

  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.update();
  }

  private async refreshSpecs(): Promise<void> {
    this.specs = await this.loadSpecs();
    this.aggregatePercent = this.computeAggregate(this.specs);
    this.update();
  }

  private computeAggregate(specs: readonly SpecEntry[]): number {
    if (specs.length === 0) return 0;
    const totalPercent = specs.reduce((sum, s) => sum + s.progress.percent, 0);
    return Math.round(totalPercent / specs.length);
  }

  private async loadSpecs(): Promise<readonly SpecEntry[]> {
    const root = this.workspaceRoot();
    if (!root) return [];
    const entries: SpecEntry[] = [];
    for (const spcsDir of allSpecsDirs(root)) {
      try {
        const stat = await this.fileService.resolve(spcsDir);
        for (const child of stat.children ?? []) {
          if (!child.isFile || !child.name.endsWith(".md")) continue;
          if (!SPEC_FILE_RE.test(child.name)) continue;
          const entry = await this.buildEntry(child.resource, child.name, spcsDir);
          if (entry) entries.push(entry);
        }
      } catch {
        // directory absent — skip silently
      }
    }
    return entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  private async buildEntry(
    uri: URI,
    filename: string,
    spcsDir: URI,
  ): Promise<SpecEntry | undefined> {
    const slugMatch = filename.match(SPEC_SLUG_RE);
    if (!slugMatch) return undefined;
    const slug = slugMatch[1]!;

    try {
      const file = await this.fileService.read(uri);
      const spec = parseSpec(file.value, uri.toString());
      const contextDir = spcsDir.resolve(SPEC_CONTEXT_DIR).resolve(slug);
      const hasContext = await this.hasContextEntries(contextDir);
      const hasClarifications = await this.exists(contextDir.resolve("clarifications.md"));
      const planTasks = await this.loadPlanTasks(contextDir, slug);
      const hasPlan = planTasks.length > 0;
      const driftReport = await this.loadDriftReport(contextDir);
      const signals = {
        hasAcceptanceCriteria: hasAuthoredAcceptanceCriteria(spec.acceptanceCriteria),
        hasContext,
        hasClarifications,
        hasPlan,
        ...(driftReport ? { driftReport } : {}),
      };
      return {
        uri: uri.toString(),
        name: filename,
        title: spec.frontmatter.title || filename,
        progress: computeEffectiveProgress(spec.frontmatter, signals),
        planTasks,
      };
    } catch {
      return {
        uri: uri.toString(),
        name: filename,
        title: filename,
        progress: computeEffectiveProgress({ status: "draft" }, {
          hasAcceptanceCriteria: false,
          hasContext: false,
          hasClarifications: false,
        }),
        planTasks: [],
      };
    }
  }

  private async hasContextEntries(dir: URI): Promise<boolean> {
    try {
      const stat = await this.fileService.resolve(dir);
      return (stat.children?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  private async exists(uri: URI): Promise<boolean> {
    try {
      const stat = await this.fileService.resolve(uri);
      return stat.isFile === true || (stat.children?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  private async loadPlanTasks(contextDir: URI, slug: string): Promise<readonly PlanTask[]> {
    try {
      const file = await this.fileService.read(contextDir.resolve("_plan.md"));
      const doc = parseSpecPlan(file.value, slug);
      return doc.tasks;
    } catch {
      return [];
    }
  }

  private async loadDriftReport(contextDir: URI): Promise<DriftReport | undefined> {
    try {
      const file = await this.fileService.read(contextDir.resolve("_drift.json"));
      const parsed = JSON.parse(file.value) as unknown;
      if (parsed && typeof parsed === "object" && "findings" in parsed) {
        return parsed as DriftReport;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private workspaceRoot(): URI | undefined {
    const roots = this.workspace.tryGetRoots();
    return roots[0]?.resource;
  }

  private readonly handleCreate = (): void => {
    void this.commands.executeCommand(SpexrCommands.CREATE_SPEC.id);
  };

  private readonly handleSendToAgent = (uri: string): void => {
    void this.commands.executeCommand(SpexrCommands.SPEC_HANDOFF.id, uri);
  };

  private readonly handleRetrospective = (uri: string): void => {
    void this.commands.executeCommand(SpexrCommands.SPEC_RETROSPECTIVE.id, uri);
  };

  private readonly handleOpen = (uri: string): void => {
    void this.commands.executeCommand(SpexrCommands.SPEC_OPEN.id, uri);
  };

  private readonly handleDelete = (uri: string): void => {
    void this.commands.executeCommand(SpexrCommands.SPEC_DELETE.id, uri);
  };

  private readonly handleRefresh = (): void => {
    void this.refreshSpecs();
  };

  private readonly handleStepClick = (uri: string, step: WorkflowStep): void => {
    void this.commands.executeCommand(SpexrCommands.SPEC_WORKFLOW_ACTION.id, uri, step);
  };

  private readonly handleTaskToggle = (uri: string, taskId: string): void => {
    void this.commands.executeCommand(SpexrCommands.SPEC_TOGGLE_TASK.id, uri, taskId);
  };

  // Force/unforce re-validate against a fresh disk read inside the command; if
  // this widget's rendered snapshot has drifted from disk, the command rejects
  // and no file write fires — so an onDidRunOperation refresh never comes and
  // the stale icon lingers. Always refresh after the command settles to keep
  // the stepper in sync with disk regardless of the command's outcome.
  private readonly handleForceStep = (uri: string, step: WorkflowStep): void => {
    void this.commands
      .executeCommand(SpexrCommands.SPEC_FORCE_STEP.id, uri, step)
      .then(() => this.refreshSpecs());
  };

  private readonly handleUnforceStep = (uri: string, step: WorkflowStep): void => {
    void this.commands
      .executeCommand(SpexrCommands.SPEC_UNFORCE_STEP.id, uri, step)
      .then(() => this.refreshSpecs());
  };

  protected render(): React.ReactNode {
    return (
      <SpecPanel
        specs={this.specs}
        hasWorkspace={Boolean(this.workspaceRoot())}
        aggregatePercent={this.aggregatePercent}
        onCreate={this.handleCreate}
        onSendToAgent={this.handleSendToAgent}
        onRetrospective={this.handleRetrospective}
        onOpen={this.handleOpen}
        onDelete={this.handleDelete}
        onRefresh={this.handleRefresh}
        onStepClick={this.handleStepClick}
        onTaskToggle={this.handleTaskToggle}
        onForceStep={this.handleForceStep}
        onUnforceStep={this.handleUnforceStep}
      />
    );
  }
}

const SpecPanel: React.FC<SpecPanelProps> = ({
  specs,
  hasWorkspace,
  aggregatePercent,
  onCreate,
  onSendToAgent,
  onRetrospective,
  onOpen,
  onDelete,
  onRefresh,
  onStepClick,
  onTaskToggle,
  onForceStep,
  onUnforceStep,
}) => (
  <section className="spexr-spec-panel" aria-label="Specs">
    <header className="spexr-spec-panel__header">
      <h2>Specs</h2>
      <p className="spexr-spec-panel__hint">
        {hasWorkspace
          ? `Files under docs/specs/ at the workspace root. Each spec moves through ${WORKFLOW_STEP_ORDER.length} workflow steps.`
          : "Open a workspace to list its specs."}
      </p>
    </header>

    {hasWorkspace && specs.length > 0 ? (
      <WorkspaceProgressBar percent={aggregatePercent} specCount={specs.length} />
    ) : null}

    <div className="spexr-spec-panel__actions">
      <button type="button" className="spexr-button spexr-button--primary" onClick={onCreate}>
        Create new spec
      </button>
      <button
        type="button"
        className="spexr-button"
        onClick={onRefresh}
        disabled={!hasWorkspace}
      >
        Refresh
      </button>
    </div>

    {hasWorkspace && specs.length === 0 ? (
      <p className="spexr-spec-panel__empty">
        No specs yet. Create one to populate <code>docs/specs/</code>.
      </p>
    ) : null}

    {specs.length > 0 ? (
      <ul className="spexr-spec-list" role="list">
        {specs.map((spec) => {
          const isComplete = spec.progress.currentStep === "done";
          return (
          <li key={spec.uri} className="spexr-spec-list__item">
            <div className="spexr-spec-list__row">
              <div className="spexr-spec-list__meta">
                <span className="spexr-spec-list__title">{spec.title}</span>
                <span className="spexr-spec-list__filename">{spec.name}</span>
              </div>
              <SpecWorkflowStepper
                progress={spec.progress}
                onStepClick={(step) => onStepClick(spec.uri, step)}
                planTasks={spec.planTasks}
                onTaskToggle={(taskId) => onTaskToggle(spec.uri, taskId)}
                unverifiedForcedSteps={spec.progress.unverifiedForcedSteps}
                {...(spec.progress.undoableForcedStep
                  ? { undoableStep: spec.progress.undoableForcedStep }
                  : {})}
                onForceStep={(step) => onForceStep(spec.uri, step)}
                onUnforceStep={(step) => onUnforceStep(spec.uri, step)}
              />
              <div className="spexr-spec-list__actions">
                {isComplete ? (
                  <button
                    type="button"
                    className="spexr-button spexr-button--primary spexr-button--compact"
                    onClick={() => onRetrospective(spec.uri)}
                    aria-label={`Run retrospective with agent for ${spec.title}`}
                  >
                    Retrospective with agent
                  </button>
                ) : (
                  <button
                    type="button"
                    className="spexr-button spexr-button--primary spexr-button--compact"
                    onClick={() => onSendToAgent(spec.uri)}
                    aria-label={`Chat with agent about ${spec.title}`}
                  >
                    Chat with agent
                  </button>
                )}
                <button
                  type="button"
                  className="spexr-button spexr-button--ghost spexr-button--compact"
                  onClick={() => onOpen(spec.uri)}
                  aria-label={`Open ${spec.title}`}
                >
                  Open
                </button>
                <button
                  type="button"
                  className="spexr-button spexr-button--ghost spexr-button--compact spexr-button--danger"
                  onClick={() => onDelete(spec.uri)}
                  aria-label={`Delete ${spec.title}`}
                  title="Delete spec (and its context folder)"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
          );
        })}
      </ul>
    ) : null}
  </section>
);
