import { injectable, inject, optional } from "@theia/core/shared/inversify";
import {
  type CommandContribution,
  type CommandRegistry,
  type Command,
  type MenuContribution,
  type MenuModelRegistry,
  MessageService,
} from "@theia/core";
import { CommonMenus, ConfirmDialog, QuickInputService } from "@theia/core/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import { EditorManager } from "@theia/editor/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileDialogService } from "@theia/filesystem/lib/browser/file-dialog/file-dialog-service";
import URI from "@theia/core/lib/common/uri";
import {
  computeProgress,
  effectiveCurrentStep,
  forceCompleteStep,
  hasAuthoredAcceptanceCriteria,
  parseSpec,
  parseSpecPlan,
  patchFrontmatter,
  persistedStateForStep,
  resolveCurrentStep,
  serializeSpecPlan,
  togglePlanTask,
  unforceStep as unforceWorkflowStep,
  WORKFLOW_STEP_EXPERT,
  WORKFLOW_STEP_LABEL,
  WORKFLOW_STEP_ORDER,
  type DriftReport,
  type WorkflowStep,
} from "@spexr/spec";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import { SpexrShellLayoutContribution } from "../shell/spexr-shell-layout-contribution.js";
import { SpexrSpecResourcesViewContribution } from "../views/spec-resources-view-contribution.js";
import { memoryDir, specsDir, specContextDir, agentsDir, allSpecsDirs, SPEC_CONTEXT_DIR } from "../workspace-paths.js";
import { buildSpecHandoff, parseLinksFile, type ContextFileEntry, type ContextLink } from "@spexr/agent";
import { serializeExpertFile } from "../views/experts-format.js";
import { SpexrAgentServiceProxy } from "../agent/agent-service-proxy.js";
import type { SpexrAgentService, ExpertAgentDto, DriftReportDto } from "../../common/agent-protocol.js";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { PreferenceScope } from "@theia/core/lib/common/preferences/preference-scope";
import { SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE } from "../preferences/spexr-preferences.js";

export const SpexrCommands = {
  CREATE_SPEC: { id: "spexr.spec.create", label: "Spexr: Create new spec" } satisfies Command,
  NEW_PROJECT: { id: "spexr.project.new", label: "Spexr: New project" } satisfies Command,
  SPEC_HANDOFF: {
    id: "spexr.spec.handoff",
    label: "Spexr: Send spec to agent",
  } satisfies Command,
  SPEC_RETROSPECTIVE: {
    id: "spexr.spec.retrospective",
    label: "Spexr: Run spec retrospective with agent",
  } satisfies Command,
  SPEC_OPEN: {
    id: "spexr.spec.open",
    label: "Spexr: Open spec",
  } satisfies Command,
  SPEC_ADD_CONTEXT: {
    id: "spexr.spec.context.add",
    label: "Spexr: Add context to spec",
  } satisfies Command,
  SPEC_CONTEXT_OPEN: {
    id: "spexr.spec.context.open",
    label: "Spexr: Open linked resource",
  } satisfies Command,
  SPEC_CONTEXT_REMOVE: {
    id: "spexr.spec.context.remove",
    label: "Spexr: Remove linked resource",
  } satisfies Command,
  SPEC_RESOURCES_TOGGLE: {
    id: "spexr.spec.resources.toggle",
    label: "Spexr: Toggle linked resources panel",
  } satisfies Command,
  RESET_LAYOUT: {
    id: "spexr.layout.reset",
    label: "Spexr: Reset layout",
  } satisfies Command,
  SPEC_DELETE: {
    id: "spexr.spec.delete",
    label: "Spexr: Delete spec",
  } satisfies Command,
  MEMORY_ADD: {
    id: "spexr.memory.add",
    label: "Spexr: Add memory",
  } satisfies Command,
  MEMORY_OPEN: {
    id: "spexr.memory.open",
    label: "Spexr: Open memory",
  } satisfies Command,
  MEMORY_DELETE: {
    id: "spexr.memory.delete",
    label: "Spexr: Delete memory",
  } satisfies Command,
  SPEC_WORKFLOW_ACTION: {
    id: "spexr.spec.workflow.action",
    label: "Spexr: Run spec workflow step",
  } satisfies Command,
  CLAUDE_TOGGLE_EXPAND: {
    id: "spexr.claude.toggleExpand",
    label: nls.localize("spexr/agent/expandTerminal", "Expand terminal"),
  } satisfies Command,
  CLAUDE_FOCUS: {
    id: "spexr.claude.focus",
    label: "Spexr: Talk to the agent",
  } satisfies Command,
  MEMORY_LINK: {
    id: "spexr.memory.link",
    label: "Spexr: Link project memory to agent",
  } satisfies Command,
  MEMORY_UNLINK: {
    id: "spexr.memory.unlink",
    label: "Spexr: Unlink project memory from agent",
  } satisfies Command,
  MEMORY_RESOLVE_CONFLICT: {
    id: "spexr.memory.resolveConflict",
    label: "Spexr: Resolve memory link conflict",
  } satisfies Command,
  EXPERT_ADD: {
    id: "spexr.experts.add",
    label: "Spexr: Add expert to project",
  } satisfies Command,
  EXPERT_REMOVE: {
    id: "spexr.experts.remove",
    label: "Spexr: Remove expert from project",
  } satisfies Command,
  EXPERT_START: {
    id: "spexr.experts.start",
    label: "Spexr: Start session with expert",
  } satisfies Command,
  EXPERT_DEACTIVATE: {
    id: "spexr.experts.deactivate",
    label: "Spexr: Deactivate expert",
  } satisfies Command,
  EXPERT_KICKOFF: {
    id: "spexr.experts.kickoff",
    label: "Spexr: Run expert kickoff prompt",
  } satisfies Command,
  SPEC_SHIP: {
    id: "spexr.spec.ship",
    label: "Spexr: Ship spec (branch, commit, PR)",
  } satisfies Command,
  SPEC_CHECK_DRIFT: {
    id: "spexr.spec.checkDrift",
    label: "Spexr: Check drift (validate spec vs code)",
  } satisfies Command,
  SPEC_TOGGLE_TASK: {
    id: "spexr.spec.toggleTask",
    label: "Spexr: Toggle plan task",
  } satisfies Command,
  SPEC_FORCE_STEP: {
    id: "spexr.spec.forceStep",
    label: "Spexr: Force-complete workflow step",
  } satisfies Command,
  SPEC_UNFORCE_STEP: {
    id: "spexr.spec.unforceStep",
    label: "Spexr: Undo forced workflow step",
  } satisfies Command,
} as const;

const MEMORY_TYPES = ["user", "feedback", "project", "reference"] as const;
type MemoryType = (typeof MEMORY_TYPES)[number];

const MEMORY_TYPE_DESCRIPTIONS: Record<MemoryType, string> = {
  user: "Who the user is, how they work",
  feedback: "Corrections, validated approaches",
  project: "Ongoing work, deadlines, motivations",
  reference: "Where to look — external systems, dashboards",
};

const MEMORY_TEMPLATE = (
  name: string,
  description: string,
  type: MemoryType,
) => `---
name: ${name}
description: ${description}
type: ${type}
---

`;

/** Experts NOT installed when seeding a fresh project (added manually instead). */
const DEFAULT_EXCLUDED_EXPERTS = new Set(["marketing"]);

const SPEC_FILE_RE = /^(\d{4})-([a-z0-9][a-z0-9-]*)\.md$/;
const URL_RE = /^https?:\/\/\S+$/i;

const SPEC_TEMPLATE = (slug: string, title: string, today: string) => `---
slug: ${slug}
title: ${title}
status: draft
createdAt: ${today}
---

## Goal

Describe the user-facing outcome this spec delivers.

## Non-goals

-

## Acceptance Criteria

<!-- One bullet per criterion: - **AC-1** The system … -->

## Notes
`;

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Reference to a single linked resource, passed from the resources panel. */
interface SpecResourceRef {
  readonly specUri: string;
  readonly kind: "file" | "link";
  readonly label: string;
  readonly href?: string;
}

type WorkflowPromptBuilder = (slug: string, specBody: string, driftBlock: string) => string;

const WORKFLOW_PROMPTS: Record<WorkflowStep, WorkflowPromptBuilder> = {
  specify: (slug, specBody) =>
    `Help me refine spec ${slug}. Review the current draft, suggest missing acceptance criteria, tighten goal/non-goals.\n\n---\n${specBody}`,
  context: (slug) =>
    `I'm gathering reference material for spec ${slug}. Ask me which files or URLs are relevant; I'll attach them via "Add context".`,
  clarify: (slug, specBody) =>
    `Spec ${slug} needs clarification before planning. List 5–10 open questions on the acceptance criteria below. For each, propose an answer using any context under docs/specs/.context/${slug}/. Write the final Q&A to docs/specs/.context/${slug}/clarifications.md so the next step can reference it.\n\n---\n${specBody}`,
  plan: (slug, specBody) =>
    `Draft an implementation plan for spec ${slug}. Write the plan as \`docs/specs/.context/${slug}/_plan.md\` using this exact format:\n\n` +
    "```\n---\nspecSlug: " + slug + "\ngeneratedAt: <ISO timestamp>\n---\n\n- [ ] T1 (AC-1): task description\n- [ ] T2 (AC-2): task description\n```\n\n" +
    `Each task must reference a real AC id from the spec. Do not write code yet.\n\n---\n${specBody}`,
  implement: (slug, specBody) =>
    `Execute the plan for spec ${slug}. Edit files as needed; reference AC IDs in each commit message and include a \`Spec: ${slug}\` trailer. Stop after each logical chunk for review.\n\n---\n${specBody}`,
  validate: (slug, specBody, driftBlock) =>
    `Validate spec ${slug}. For each acceptance criterion below, verify the current code satisfies it. Run tests if available. Report pass/fail per AC and list remaining gaps.\n\n${driftBlock}\n\n---\n${specBody}`,
  ship: (slug, specBody) =>
    `Prepare to ship spec ${slug}. Draft a PR title (≤70 chars) and body summarizing the change, AC covered, and test plan. End with \`Spec: ${slug}\` trailer. Do not push.\n\n---\n${specBody}`,
};

/**
 * Prompt sent when a completed spec hands off for retrospective instead of
 * forward progress. The focus is analysis of what was delivered, not new work.
 */
const RETROSPECTIVE_PROMPT = (slug: string, specBody: string): string =>
  `Run a retrospective on spec ${slug}. The work is complete — do NOT propose new implementation or edit files. Analyze what was done against the spec below.\n\n1. For each acceptance criterion, state whether it was met, partially met, or dropped — and why.\n2. Note deviations from the original spec and what drove them.\n3. Call out what went well and what slowed delivery.\n4. List residual risks, tech debt, and concrete follow-up items.\n5. Propose any project-memory entries worth saving (decisions, gotchas) under docs/memory/.\n\n---\n${specBody}`;

@injectable()
export class SpexrCommandsContribution implements CommandContribution, MenuContribution {
  @inject(QuickInputService)
  private readonly quickInput!: QuickInputService;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(FileDialogService)
  private readonly fileDialog!: FileDialogService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  @inject(ClaudeTerminalManager)
  private readonly claudeTerminal!: ClaudeTerminalManager;

  @inject(EditorManager)
  private readonly editorManager!: EditorManager;

  @inject(SpexrShellLayoutContribution)
  private readonly shellLayout!: SpexrShellLayoutContribution;

  @inject(SpexrSpecResourcesViewContribution)
  private readonly specResourcesView!: SpexrSpecResourcesViewContribution;

  @optional()
  @inject(SpexrAgentServiceProxy)
  private readonly agentService!: SpexrAgentService | undefined;

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(SpexrCommands.CREATE_SPEC, {
      execute: () => this.createSpec(),
    });
    commands.registerCommand(SpexrCommands.NEW_PROJECT, {
      execute: () => this.newProject(),
    });
    commands.registerCommand(SpexrCommands.SPEC_HANDOFF, {
      execute: (raw: unknown) => this.handoffSpec(this.resolveSpecUri(raw)),
    });
    commands.registerCommand(SpexrCommands.SPEC_RETROSPECTIVE, {
      execute: (raw: unknown) => this.retrospectiveSpec(this.resolveSpecUri(raw)),
    });
    commands.registerCommand(SpexrCommands.SPEC_OPEN, {
      execute: (raw: unknown) => this.openSpec(this.resolveSpecUri(raw)),
    });
    commands.registerCommand(SpexrCommands.SPEC_ADD_CONTEXT, {
      execute: (raw: unknown) => this.addSpecContext(this.resolveSpecUri(raw)),
    });
    commands.registerCommand(SpexrCommands.SPEC_CONTEXT_OPEN, {
      execute: (raw: unknown) => this.openSpecContext(this.resolveResourceRef(raw)),
    });
    commands.registerCommand(SpexrCommands.SPEC_CONTEXT_REMOVE, {
      execute: (raw: unknown) => this.removeSpecContext(this.resolveResourceRef(raw)),
    });
    commands.registerCommand(SpexrCommands.SPEC_RESOURCES_TOGGLE, {
      execute: (raw: unknown) => this.toggleSpecResources(this.resolveSpecUri(raw)),
    });
    commands.registerCommand(SpexrCommands.RESET_LAYOUT, {
      execute: () => this.resetLayout(),
    });
    commands.registerCommand(SpexrCommands.SPEC_DELETE, {
      execute: (raw: unknown) => this.deleteSpec(this.resolveSpecUri(raw)),
    });
    commands.registerCommand(SpexrCommands.MEMORY_ADD, {
      execute: () => this.addMemory(),
    });
    commands.registerCommand(SpexrCommands.MEMORY_OPEN, {
      execute: (raw: unknown) => this.openMemory(this.resolveMemoryUri(raw)),
    });
    commands.registerCommand(SpexrCommands.MEMORY_DELETE, {
      execute: (raw: unknown) => this.deleteMemory(this.resolveMemoryUri(raw)),
    });
    commands.registerCommand(SpexrCommands.SPEC_WORKFLOW_ACTION, {
      execute: (rawUri: unknown, rawStep: unknown) =>
        this.runWorkflowStep(this.resolveSpecUri(rawUri), this.coerceWorkflowStep(rawStep)),
    });
    commands.registerCommand(SpexrCommands.CLAUDE_TOGGLE_EXPAND, {
      execute: () => this.toggleClaudeExpand(),
    });
    commands.registerCommand(SpexrCommands.CLAUDE_FOCUS, {
      execute: () => this.claudeTerminal.ensureStarted(),
    });
    commands.registerCommand(SpexrCommands.MEMORY_LINK, {
      execute: () => this.linkMemory(),
    });
    commands.registerCommand(SpexrCommands.MEMORY_UNLINK, {
      execute: () => this.unlinkMemory(),
    });
    commands.registerCommand(SpexrCommands.MEMORY_RESOLVE_CONFLICT, {
      execute: () => this.resolveMemoryConflict(),
    });
    commands.registerCommand(SpexrCommands.EXPERT_ADD, {
      execute: (raw: unknown) => this.addExpert(raw),
    });
    commands.registerCommand(SpexrCommands.EXPERT_REMOVE, {
      execute: (raw: unknown) => this.removeExpert(typeof raw === "string" ? raw : undefined),
    });
    commands.registerCommand(SpexrCommands.EXPERT_START, {
      execute: (raw: unknown) => this.startExpert(raw),
    });
    commands.registerCommand(SpexrCommands.EXPERT_DEACTIVATE, {
      execute: () => this.deactivateExpert(),
    });
    commands.registerCommand(SpexrCommands.EXPERT_KICKOFF, {
      execute: (raw: unknown) => this.kickoffExpert(raw),
    });
    commands.registerCommand(SpexrCommands.SPEC_SHIP, {
      execute: (raw: unknown) =>
        this.runWorkflowStep(this.resolveSpecUri(raw), "ship"),
    });
    commands.registerCommand(SpexrCommands.SPEC_CHECK_DRIFT, {
      execute: (raw: unknown) =>
        this.runWorkflowStep(this.resolveSpecUri(raw), "validate"),
    });
    commands.registerCommand(SpexrCommands.SPEC_TOGGLE_TASK, {
      execute: (rawUri: unknown, rawTaskId: unknown) =>
        this.togglePlanTask(this.resolveSpecUri(rawUri), typeof rawTaskId === "string" ? rawTaskId : undefined),
    });
    commands.registerCommand(SpexrCommands.SPEC_FORCE_STEP, {
      execute: (rawUri: unknown, rawStep: unknown) =>
        this.forceStep(this.resolveSpecUri(rawUri), this.coerceWorkflowStep(rawStep)),
    });
    commands.registerCommand(SpexrCommands.SPEC_UNFORCE_STEP, {
      execute: (rawUri: unknown, rawStep: unknown) =>
        this.unforceStep(this.resolveSpecUri(rawUri), this.coerceWorkflowStep(rawStep)),
    });
  }

  private coerceWorkflowStep(raw: unknown): WorkflowStep | undefined {
    if (typeof raw !== "string") return undefined;
    if (raw in WORKFLOW_STEP_LABEL) return raw as WorkflowStep;
    return undefined;
  }

  private async runWorkflowStep(
    uri: URI | undefined,
    step: WorkflowStep | undefined,
  ): Promise<void> {
    if (!uri || !step) {
      this.messages.warn("Workflow action requires a spec and a step.");
      return;
    }

    try {
      await this.flushDirtyEditor(uri);
      const file = await this.fileService.read(uri);
      const spec = parseSpec(file.value, uri.toString());
      const fsSignals = await this.loadWorkflowSignals(uri, spec.frontmatter.slug);
      const signals = {
        ...fsSignals,
        hasAcceptanceCriteria: hasAuthoredAcceptanceCriteria(spec.acceptanceCriteria),
      };
      const currentStep = resolveCurrentStep(spec.frontmatter, signals);
      const progress = computeProgress(currentStep);
      if (progress.stateByStep[step] === "pending") {
        this.warnDependency(step, currentStep);
        return;
      }

      if (step === "specify") {
        // Open the editor only; specify stays current until acceptance criteria
        // are authored, at which point resolveCurrentStep advances to context.
        // Persisting workflowStep="specify" would pin it and deadlock the flow.
        await this.openSpec(uri);
        return;
      }
      if (step === "context") {
        await this.persistStep(uri, step);
        await this.addSpecContext(uri);
        return;
      }
      if (step === "ship") {
        await this.executeShipSpec(uri, spec);
        return;
      }
      if (step === "validate") {
        await this.executeCheckDrift(uri, spec);
        return;
      }

      const prompt = this.buildWorkflowPrompt(step, spec.frontmatter.slug, spec.raw);
      await this.applyStepExpert(step);
      await this.claudeTerminal.ensureStarted();
      await this.sendAndSubmit(prompt.body);
      await this.claudeTerminal.reveal();
      await this.persistStep(uri, step);
      this.messages.info(`Sent ${WORKFLOW_STEP_LABEL[step]} prompt for ${spec.frontmatter.slug}.`);
    } catch (err) {
      console.error("[spexr] runWorkflowStep failed", err);
      this.messages.error(
        `Workflow step failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private warnDependency(target: WorkflowStep, currentStep: WorkflowStep | "done"): void {
    const targetLabel = WORKFLOW_STEP_LABEL[target];
    if (currentStep === "done") {
      this.messages.warn(`Cannot start "${targetLabel}" — spec is already complete.`);
      return;
    }
    const targetIdx = WORKFLOW_STEP_ORDER.indexOf(target);
    const currentIdx = WORKFLOW_STEP_ORDER.indexOf(currentStep);
    const missing = WORKFLOW_STEP_ORDER.slice(currentIdx, targetIdx)
      .map((s) => WORKFLOW_STEP_LABEL[s])
      .join(", ");
    this.messages.warn(
      `Cannot start "${targetLabel}" — complete previous step${missing.includes(",") ? "s" : ""} first: ${missing}.`,
    );
  }

  private async loadWorkflowSignals(
    specUri: URI,
    slug: string,
  ): Promise<{ hasContext: boolean; hasClarifications: boolean; hasPlan: boolean; driftReport?: DriftReport }> {
    const specsDir = specUri.parent;
    const contextDir = specsDir.resolve(".context").resolve(slug);
    const hasContext = await this.hasAnyEntry(contextDir);
    const hasClarifications = await this.exists(contextDir.resolve("clarifications.md"));
    const hasPlan = (await this.loadPlanTaskCount(contextDir, slug)) > 0;
    const driftReport = await this.loadPersistedDriftReport(contextDir);
    return { hasContext, hasClarifications, hasPlan, ...(driftReport ? { driftReport } : {}) };
  }

  private async loadPlanTaskCount(contextDir: URI, slug: string): Promise<number> {
    try {
      const file = await this.fileService.read(contextDir.resolve("_plan.md"));
      return parseSpecPlan(file.value, slug).tasks.length;
    } catch {
      return 0;
    }
  }

  private async loadPersistedDriftReport(contextDir: URI): Promise<DriftReport | undefined> {
    try {
      const file = await this.fileService.read(contextDir.resolve("_drift.json"));
      const dto = JSON.parse(file.value) as DriftReportDto;
      return {
        specSlug: dto.specSlug,
        checkedAt: dto.checkedAt,
        findings: dto.findings as DriftReport["findings"],
      };
    } catch {
      return undefined;
    }
  }

  private async hasAnyEntry(dir: URI): Promise<boolean> {
    try {
      const stat = await this.fileService.resolve(dir);
      return (stat.children?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  private async persistStep(uri: URI, step: WorkflowStep): Promise<void> {
    try {
      const current = await this.fileService.read(uri);
      const persisted = persistedStateForStep(step);
      const today = new Date().toISOString().slice(0, 10);
      const next = patchFrontmatter(current.value, {
        ...(persisted.status ? { status: persisted.status } : {}),
        workflowStep: persisted.workflowStep,
        updatedAt: today,
      });
      if (next !== current.value) {
        await this.fileService.write(uri, next);
      }
    } catch (err) {
      console.error("[spexr] persistStep failed", err);
    }
  }

  private async executeShipSpec(
    uri: URI,
    spec: ReturnType<typeof parseSpec>,
  ): Promise<void> {
    if (!this.agentService) {
      this.messages.error("Ship failed: agent backend service unavailable.");
      return;
    }
    const rootUri = this.workspaceRoot();
    if (!rootUri) {
      this.messages.error("Ship failed: no workspace root found.");
      return;
    }
    const root = rootUri.path.toString();
    const { slug, title } = spec.frontmatter;
    const acItems = spec.acceptanceCriteria.map((c) => `**${c.id}** ${c.text}`);

    await this.persistStep(uri, "ship");

    const outcome = await this.agentService.shipSpec(root, slug, title, acItems);

    if (!outcome.ok) {
      const hints: Record<string, string> = {
        "gh-not-found": "Install GitHub CLI: https://cli.github.com",
        "gh-auth": "Run `gh auth login` in your terminal.",
        "no-remote": "Add a git remote: `git remote add origin <url>`.",
        "nothing-to-ship": "Stage or commit your changes first.",
      };
      const hint = hints[outcome.code] ?? "";
      this.messages.error(`Ship failed: ${outcome.message}${hint ? `\n${hint}` : ""}`);
      return;
    }

    await this.persistShipped(uri);
    this.messages.info(`Spec shipped! PR: ${outcome.prUrl}`);
  }

  private async executeCheckDrift(
    uri: URI,
    spec: ReturnType<typeof parseSpec>,
  ): Promise<void> {
    if (!this.agentService) {
      this.messages.error("Drift check failed: agent backend service unavailable.");
      return;
    }
    const rootUri = this.workspaceRoot();
    if (!rootUri) {
      this.messages.error("Drift check failed: no workspace root found.");
      return;
    }
    const root = rootUri.path.toString();
    const { slug } = spec.frontmatter;

    await this.persistStep(uri, "validate");
    this.messages.info(`Running drift check for ${slug}… (this may take a moment)`);

    let dto: DriftReportDto;
    try {
      dto = await this.agentService.checkDrift(root, slug, spec.raw);
    } catch (err) {
      this.messages.error(`Drift check failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const blockCount = dto.findings.filter((f) => f.severity === "block").length;
    const warnCount = dto.findings.filter((f) => f.severity === "warn").length;
    const infoCount = dto.findings.filter((f) => f.severity === "info").length;
    const summary = [
      blockCount > 0 ? `${blockCount} block` : "",
      warnCount > 0 ? `${warnCount} warn` : "",
      infoCount > 0 ? `${infoCount} ok` : "",
    ].filter(Boolean).join(", ");

    if (blockCount > 0) {
      this.messages.error(`Drift check: ${summary}. Fix blocking issues before shipping.`);
    } else if (dto.findings.length === 0) {
      this.messages.info(`Drift check: no issues — spec ${slug} is ready to ship.`);
    } else {
      this.messages.warn(`Drift check: ${summary}. Review warnings before shipping.`);
    }
  }

  private async persistShipped(uri: URI): Promise<void> {
    try {
      const current = await this.fileService.read(uri);
      const today = new Date().toISOString().slice(0, 10);
      const next = patchFrontmatter(current.value, {
        status: "shipped",
        workflowStep: "ship",
        updatedAt: today,
      });
      if (next !== current.value) {
        await this.fileService.write(uri, next);
      }
    } catch (err) {
      console.error("[spexr] persistShipped failed", err);
    }
  }

  private async togglePlanTask(uri: URI | undefined, taskId: string | undefined): Promise<void> {
    if (!uri || !taskId) return;
    try {
      const file = await this.fileService.read(uri);
      const spec = parseSpec(file.value, uri.toString());
      const { slug } = spec.frontmatter;
      const specsDir = uri.parent;
      const planUri = specsDir.resolve(SPEC_CONTEXT_DIR).resolve(slug).resolve("_plan.md");
      await this.flushDirtyEditor(planUri);
      const planFile = await this.fileService.read(planUri);
      const doc = parseSpecPlan(planFile.value, slug);
      const updated = togglePlanTask(doc, taskId);
      await this.fileService.create(planUri, serializeSpecPlan(updated), { overwrite: true });
    } catch (err) {
      this.messages.error(`Failed to toggle task: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async forceStep(uri: URI | undefined, step: WorkflowStep | undefined): Promise<void> {
    if (!uri || !step) return;
    try {
      await this.flushDirtyEditor(uri);
      const file = await this.fileService.read(uri);
      const spec = parseSpec(file.value, uri.toString());
      const fsSignals = await this.loadWorkflowSignals(uri, spec.frontmatter.slug);
      const signals = {
        ...fsSignals,
        hasAcceptanceCriteria: hasAuthoredAcceptanceCriteria(spec.acceptanceCriteria),
      };
      const result = forceCompleteStep(spec.frontmatter, signals, step);
      if (!result.ok) {
        this.messages.warn(result.error!);
        return;
      }
      const effective = effectiveCurrentStep(
        { ...spec.frontmatter, forcedSteps: result.forcedSteps },
        signals,
      );
      await this.persistForcedSteps(uri, result.forcedSteps, effective);
    } catch (err) {
      this.messages.error(`Failed to force step: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private async unforceStep(uri: URI | undefined, step: WorkflowStep | undefined): Promise<void> {
    if (!uri || !step) return;
    try {
      await this.flushDirtyEditor(uri);
      const file = await this.fileService.read(uri);
      const spec = parseSpec(file.value, uri.toString());
      const result = unforceWorkflowStep(spec.frontmatter, step);
      if (!result.ok) {
        this.messages.warn(result.error!);
        return;
      }
      const fsSignals = await this.loadWorkflowSignals(uri, spec.frontmatter.slug);
      const signals = {
        ...fsSignals,
        hasAcceptanceCriteria: hasAuthoredAcceptanceCriteria(spec.acceptanceCriteria),
      };
      const effective = effectiveCurrentStep(
        { ...spec.frontmatter, forcedSteps: result.forcedSteps },
        signals,
      );
      await this.persistForcedSteps(uri, result.forcedSteps, effective);
    } catch (err) {
      this.messages.error(`Failed to undo forced step: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Persist the new forcedSteps list, and keep the frontmatter's own
   * `workflowStep` field in sync with the resulting effective step so the two
   * persistence channels don't drift (a reader using only the natural
   * progression then sees the same position the forced overlay computes).
   * When the spec is effectively "done", workflowStep is left untouched —
   * "done" is not a step, and it is derived from status, not workflowStep.
   */
  private async persistForcedSteps(
    uri: URI,
    forcedSteps: readonly WorkflowStep[],
    effective: WorkflowStep | "done",
  ): Promise<void> {
    const current = await this.fileService.read(uri);
    const today = new Date().toISOString().slice(0, 10);
    const next = patchFrontmatter(current.value, {
      forcedSteps: forcedSteps.length > 0 ? forcedSteps : null,
      ...(effective !== "done" ? { workflowStep: effective } : {}),
      updatedAt: today,
    });
    if (next !== current.value) {
      await this.fileService.write(uri, next);
    }
  }

  private buildWorkflowPrompt(
    step: WorkflowStep,
    slug: string,
    specBody: string,
  ): { title: string; body: string } {
    const title = `${WORKFLOW_STEP_LABEL[step]} — ${slug}`;
    const body = WORKFLOW_PROMPTS[step](slug, specBody, "");
    return { title, body };
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
      commandId: SpexrCommands.CLAUDE_FOCUS.id,
      label: "Agent",
      order: "a_spexr_agent",
    });
    menus.registerMenuAction(CommonMenus.VIEW_LAYOUT, {
      commandId: SpexrCommands.RESET_LAYOUT.id,
      label: "Reset Layout",
      order: "z_spexr_reset",
    });
    menus.registerMenuAction(CommonMenus.VIEW_LAYOUT, {
      commandId: SpexrCommands.MEMORY_LINK.id,
      label: "Link project memory to agent",
      order: "z_spexr_memory_link",
    });
    menus.registerMenuAction(CommonMenus.VIEW_LAYOUT, {
      commandId: SpexrCommands.MEMORY_UNLINK.id,
      label: "Unlink project memory from agent",
      order: "z_spexr_memory_unlink",
    });
    menus.registerMenuAction(CommonMenus.VIEW_LAYOUT, {
      commandId: SpexrCommands.MEMORY_RESOLVE_CONFLICT.id,
      label: "Resolve memory link conflict",
      order: "z_spexr_memory_resolve",
    });
  }

  private async deleteSpec(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Delete spec requires a file URI.");
      return;
    }
    const filename = uri.path.base;
    const slug = this.specSlug(uri);
    const root = this.workspaceRoot();
    const contextDir =
      root && slug ? specContextDir(root, slug) : undefined;
    const hasContext = contextDir ? await this.exists(contextDir) : false;

    const detail = hasContext
      ? `Also deletes context folder docs/specs/.context/${slug}/. This cannot be undone.`
      : "This cannot be undone.";
    const confirmed = await new ConfirmDialog({
      title: `Delete ${filename}?`,
      msg: detail,
      ok: "Delete",
      cancel: "Cancel",
    }).open();
    if (!confirmed) return;

    try {
      await this.fileService.delete(uri, { useTrash: false, recursive: false });
      if (contextDir && hasContext) {
        await this.fileService.delete(contextDir, { useTrash: false, recursive: true });
      }
      this.messages.info(`Deleted ${filename}.`);
    } catch (err) {
      console.error("[spexr] deleteSpec failed", err);
      this.messages.error(
        `Delete spec failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async toggleClaudeExpand(): Promise<void> {
    await this.claudeTerminal.toggleExpand();
  }

  private async linkMemory(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before linking project memory.");
      return;
    }
    const workspaceRoot = root.path.toString();
    await this.claudeTerminal.linkMemory(workspaceRoot);
    this.messages.info("Project memory linked to Claude agent.");
  }

  private async unlinkMemory(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before unlinking project memory.");
      return;
    }
    const workspaceRoot = root.path.toString();
    const configDir = this.claudeTerminal.currentConfigDir();
    const slug = workspaceRoot.replace(/[^a-zA-Z0-9]/g, "-");
    const configRoot = configDir ?? "~/.claude";
    const target = `${configRoot}/projects/${slug}/memory`;
    const confirmed = await new ConfirmDialog({
      title: "Unlink project memory?",
      msg: [
        `This removes the link at ${target} so the Claude session for this account`,
        `stops reading ${workspaceRoot}/docs/memory.`,
        "Your memory files are NOT deleted — only the symlink is removed.",
        "You can re-link anytime.",
      ].join(" "),
      ok: "Unlink",
      cancel: "Cancel",
      maxWidth: 480,
    }).open();
    if (!confirmed) return;
    await this.claudeTerminal.unlinkMemory(workspaceRoot);
    this.messages.info("Project memory unlinked from Claude agent.");
  }

  private async resolveMemoryConflict(): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before resolving a memory conflict.");
      return;
    }
    const workspaceRoot = root.path.toString();
    const configDir = this.claudeTerminal.currentConfigDir();
    const slug = workspaceRoot.replace(/[^a-zA-Z0-9]/g, "-");
    const configRoot = configDir ?? "~/.claude";
    const target = `${configRoot}/projects/${slug}/memory`;
    const confirmed = await new ConfirmDialog({
      title: "Resolve memory link conflict?",
      msg: [
        `Claude already keeps memory at ${target}.`,
        "Resolving moves that existing folder aside to a timestamped backup",
        "(nothing is deleted) and links SPEXR's docs/memory in its place.",
        "You can merge the backup manually afterwards.",
      ].join(" "),
      ok: "Resolve & link",
      cancel: "Cancel",
      maxWidth: 480,
    }).open();
    if (!confirmed) return;
    await this.claudeTerminal.resolveMemoryConflict(workspaceRoot);
    this.messages.info("Project memory linked. Any existing memory was backed up alongside it.");
  }

  /**
   * Activate the expert mapped to a workflow step before handing off to the
   * agent. Falls back to the base agent when the mapped expert is not installed
   * or the step maps to no expert. No-ops when the desired persona is already
   * active so an in-flight session is not needlessly relaunched.
   */
  private async applyStepExpert(step: WorkflowStep): Promise<void> {
    const mapped = WORKFLOW_STEP_EXPERT[step];
    const desired = mapped && (await this.isExpertInstalled(mapped)) ? mapped : undefined;
    if (desired === this.activeExpertId()) return;
    if (!desired) {
      await this.claudeTerminal.deactivateExpert();
      return;
    }
    const dto = await this.findMarketplaceExpert(desired);
    if (!dto) return;
    await this.claudeTerminal.startWithExpert({ id: dto.id, name: dto.name, icon: dto.icon });
  }

  private activeExpertId(): string | undefined {
    const stored = this.preferences.get<string>(SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE) ?? "";
    return stored.trim() || undefined;
  }

  private async isExpertInstalled(id: string): Promise<boolean> {
    const root = this.workspaceRoot();
    if (!root) return false;
    return this.exists(agentsDir(root).resolve(`${id}.md`));
  }

  private async findMarketplaceExpert(id: string): Promise<ExpertAgentDto | undefined> {
    if (!this.agentService) return undefined;
    try {
      const all = await this.agentService.listMarketplaceExperts();
      return all.find((e) => e.id === id);
    } catch {
      return undefined;
    }
  }

  private isExpertDto(raw: unknown): raw is ExpertAgentDto {
    return (
      typeof raw === "object" &&
      raw !== null &&
      typeof (raw as ExpertAgentDto).id === "string" &&
      typeof (raw as ExpertAgentDto).systemPrompt === "string"
    );
  }

  private async addExpert(raw: unknown): Promise<void> {
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before adding an expert.");
      return;
    }
    if (!this.isExpertDto(raw)) {
      this.messages.warn("Add expert requires an expert definition.");
      return;
    }
    try {
      const dir = agentsDir(root);
      await this.ensureDir(dir);
      const fileUri = dir.resolve(`${raw.id}.md`);
      const content = serializeExpertFile({
        id: raw.id,
        name: raw.name,
        icon: raw.icon,
        color: raw.color,
        systemPrompt: raw.systemPrompt,
        ...(raw.model ? { model: raw.model } : {}),
      });
      await this.fileService.create(fileUri, content, { overwrite: true });
      this.messages.info(`Added expert ${raw.name} to the project.`);
    } catch (err) {
      console.error("[spexr] addExpert failed", err);
      this.messages.error(
        `Add expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async removeExpert(id: string | undefined): Promise<void> {
    const root = this.workspaceRoot();
    if (!root || !id) {
      this.messages.warn("Remove expert requires a workspace and an expert id.");
      return;
    }
    const fileUri = agentsDir(root).resolve(`${id}.md`);
    const confirmed = await new ConfirmDialog({
      title: `Remove expert "${id}"?`,
      msg: "This deletes the persona file from docs/agents/. You can add it again from the marketplace.",
      ok: "Remove",
      cancel: "Cancel",
      maxWidth: 480,
    }).open();
    if (!confirmed) return;
    try {
      await this.fileService.delete(fileUri, { useTrash: false, recursive: false });
      const active = this.preferences.get<string>(SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE) ?? "";
      if (active === id) {
        await this.preferences.set(
          SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
          "",
          PreferenceScope.Folder,
          root.toString(),
        );
      }
      this.messages.info(`Removed expert "${id}".`);
    } catch (err) {
      console.error("[spexr] removeExpert failed", err);
      this.messages.error(
        `Remove expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async startExpert(raw: unknown): Promise<void> {
    if (!this.isExpertDto(raw)) {
      this.messages.warn("Start expert requires an expert definition.");
      return;
    }
    try {
      await this.claudeTerminal.startWithExpert({ id: raw.id, name: raw.name, icon: raw.icon });
      this.messages.info(`Started session as ${raw.name}.`);
      if (raw.kickoffPrompt) await this.sendKickoff(raw.kickoffPrompt);
    } catch (err) {
      console.error("[spexr] startExpert failed", err);
      this.messages.error(
        `Start expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Re-run an expert's kickoff prompt against the already-running session. */
  private async kickoffExpert(raw: unknown): Promise<void> {
    if (!this.isExpertDto(raw) || !raw.kickoffPrompt) {
      this.messages.warn("This expert has no kickoff prompt.");
      return;
    }
    try {
      await this.claudeTerminal.reveal();
      await this.sendKickoff(raw.kickoffPrompt);
    } catch (err) {
      console.error("[spexr] kickoffExpert failed", err);
      this.messages.error(
        `Run kickoff failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async sendKickoff(prompt: string): Promise<void> {
    await this.sendAndSubmit(prompt);
  }

  /**
   * Type a prompt into the running session and submit it.
   *
   * The claude TUI treats a single stdin chunk as a paste, so a trailing newline
   * only inserts a line break instead of submitting. Send the text, then the
   * Enter keystroke ("\r") separately once the paste has been processed, so the
   * prompt actually runs without the user pressing Enter.
   */
  private async sendAndSubmit(prompt: string): Promise<void> {
    await this.claudeTerminal.whenReady();
    this.claudeTerminal.send(prompt);
    await new Promise((resolve) => setTimeout(resolve, 200));
    this.claudeTerminal.send("\r");
  }

  private async deactivateExpert(): Promise<void> {
    try {
      await this.claudeTerminal.deactivateExpert();
      this.messages.info("Expert deactivated. Running the base agent.");
    } catch (err) {
      console.error("[spexr] deactivateExpert failed", err);
      this.messages.error(
        `Deactivate expert failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resetLayout(): Promise<void> {
    try {
      await this.shellLayout.resetLayout();
      this.messages.info("Layout reset to defaults.");
    } catch (err) {
      console.error("[spexr] resetLayout failed", err);
      this.messages.error(
        `Reset layout failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Persist the open editor for `uri` when it holds unsaved changes, so a
   * following disk read or agent rewrite sees the user's latest content instead
   * of a stale dirty buffer (and the editor reloads cleanly afterwards).
   */
  private async flushDirtyEditor(uri: URI): Promise<void> {
    const widget = this.editorManager.all.find((w) => w.editor.uri.isEqual(uri));
    if (widget?.saveable.dirty) {
      await widget.saveable.save();
    }
  }

  private async handoffSpec(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Spec handoff requires a spec file URI.");
      return;
    }
    try {
      await this.flushDirtyEditor(uri);
      const content = await this.fileService.read(uri);
      const slug = uri.path.base.replace(/\.md$/, "");
      const contextDir = uri.parent.resolve(SPEC_CONTEXT_DIR).resolve(slug);
      const { contextFiles, links } = await this.loadSpecContext(contextDir);
      const payload = buildSpecHandoff({ specBody: content.value, contextFiles, links });
      await this.claudeTerminal.ensureStarted();
      await this.sendAndSubmit(payload);
      await this.claudeTerminal.reveal();
      this.messages.info(`Sent ${slug} to agent.`);
    } catch (err) {
      console.error("[spexr] handoffSpec failed", err);
      this.messages.error(
        `Spec handoff failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async loadSpecContext(
    contextDir: URI,
  ): Promise<{ contextFiles: ContextFileEntry[]; links: ContextLink[] }> {
    const contextFiles: ContextFileEntry[] = [];
    let links: ContextLink[] = [];
    try {
      const stat = await this.fileService.resolve(contextDir);
      for (const child of stat.children ?? []) {
        if (!child.isFile) continue;
        if (child.name === "_links.md") {
          try {
            const f = await this.fileService.read(child.resource);
            links = parseLinksFile(f.value);
          } catch { /* skip malformed */ }
          continue;
        }
        try {
          const f = await this.fileService.read(child.resource);
          contextFiles.push({
            name: child.name,
            content: f.value,
            sizeBytes: new TextEncoder().encode(f.value).length,
            mtimeMs: child.mtime ?? 0,
          });
        } catch {
          // Unreadable / binary
          contextFiles.push({
            name: child.name,
            content: null,
            sizeBytes: child.size ?? 0,
            mtimeMs: child.mtime ?? 0,
          });
        }
      }
    } catch { /* context dir absent — backward compat */ }
    return { contextFiles, links };
  }

  private async retrospectiveSpec(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Spec retrospective requires a spec file URI.");
      return;
    }
    try {
      await this.flushDirtyEditor(uri);
      const content = await this.fileService.read(uri);
      const spec = parseSpec(content.value, uri.toString());
      const prompt = RETROSPECTIVE_PROMPT(spec.frontmatter.slug, spec.raw);
      await this.claudeTerminal.ensureStarted();
      await this.sendAndSubmit(prompt);
      await this.claudeTerminal.reveal();
      this.messages.info(`Started retrospective for ${spec.frontmatter.slug}.`);
    } catch (err) {
      console.error("[spexr] retrospectiveSpec failed", err);
      this.messages.error(
        `Spec retrospective failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async openSpec(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Open spec requires a file URI.");
      return;
    }
    try {
      await this.editorManager.open(uri, { mode: "activate", preview: false });
    } catch (err) {
      console.error("[spexr] openSpec failed", err);
      this.messages.error(
        `Open spec failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Reveal the resources panel for `uri` only when it is not already visible —
   * so adding from inside the panel does not re-trigger a reveal on top of it.
   */
  private async ensureSpecResourcesVisible(uri: URI): Promise<void> {
    if (this.specResourcesView.tryGetWidget()?.isVisible) return;
    await this.revealSpecResources(uri);
  }

  /** Reveal the bottom-panel resources view for the spec being opened. */
  private async revealSpecResources(uri: URI): Promise<void> {
    const title = await this.specTitle(uri);
    const widget = await this.specResourcesView.openView({ activate: false, reveal: true });
    await widget.showFor(uri.toString(), title);
  }

  /**
   * Toggle the linked-resources panel from the editor toolbar: close it when
   * visible, otherwise reveal it loaded with the active spec's resources. It
   * never opens the add picker — adding is done from inside the panel.
   */
  private async toggleSpecResources(uri: URI | undefined): Promise<void> {
    const widget = this.specResourcesView.tryGetWidget();
    if (widget?.isVisible) {
      widget.close();
      return;
    }
    if (uri) {
      await this.revealSpecResources(uri);
    } else {
      await this.specResourcesView.openView({ activate: true, reveal: true });
    }
  }

  /** Re-read the resources panel after a context change that may not emit a file operation. */
  private async refreshSpecResources(): Promise<void> {
    await this.specResourcesView.tryGetWidget()?.refresh();
  }

  private async specTitle(uri: URI): Promise<string> {
    try {
      const file = await this.fileService.read(uri);
      const spec = parseSpec(file.value, uri.toString());
      if (spec.frontmatter.title) return spec.frontmatter.title;
    } catch {
      // Fall back to the filename below.
    }
    return uri.path.base;
  }

  private async addSpecContext(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Add context requires a spec URI.");
      return;
    }
    const root = this.workspaceRoot();
    if (!root) {
      this.messages.warn("Open a workspace before adding spec context.");
      return;
    }
    const slug = this.specSlug(uri);
    if (!slug) {
      this.messages.warn("Spec filename must match NNNN-slug.md.");
      return;
    }
    await this.ensureSpecResourcesVisible(uri);
    const choice = await this.quickInput.pick(
      [
        { label: "From file…", description: "Copy local files into the spec context folder" },
        { label: "From URL…", description: "Append a link to _links.md" },
      ],
      { placeHolder: "Add spec context" },
    );
    if (!choice) return;

    const contextDir = specContextDir(root, slug);
    await this.ensureDir(contextDir);

    if (choice.label === "From file…") {
      await this.addContextFromFiles(contextDir);
    } else {
      await this.addContextFromUrl(contextDir);
    }
    await this.refreshSpecResources();
  }

  /**
   * Open a linked resource. Copied files open in the editor; links are already
   * rendered as anchors in the panel, so only the file case is handled here.
   */
  private async openSpecContext(ref: SpecResourceRef | undefined): Promise<void> {
    if (!ref) {
      this.messages.warn("Open resource requires a resource reference.");
      return;
    }
    if (ref.kind !== "file") return;
    const dir = this.resourceContextDir(ref.specUri);
    if (!dir) return;
    const target = this.safeChild(dir, ref.label);
    if (!target) return;
    try {
      await this.editorManager.open(target, { mode: "activate", preview: false });
    } catch (err) {
      console.error("[spexr] openSpecContext failed", err);
      this.messages.error(
        `Open resource failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Remove a linked resource: delete the copied file, or drop its line from
   * `_links.md` for a link. Confirms first since the deletion is permanent.
   */
  private async removeSpecContext(ref: SpecResourceRef | undefined): Promise<void> {
    if (!ref) {
      this.messages.warn("Remove resource requires a resource reference.");
      return;
    }
    const dir = this.resourceContextDir(ref.specUri);
    if (!dir) {
      this.messages.warn("Open a workspace before removing a resource.");
      return;
    }
    const confirmed = await new ConfirmDialog({
      title: `Remove "${ref.label}"?`,
      msg:
        ref.kind === "file"
          ? "This deletes the file from the spec context folder. This cannot be undone."
          : "This removes the link from _links.md. This cannot be undone.",
      ok: "Remove",
      cancel: "Cancel",
      maxWidth: 480,
    }).open();
    if (!confirmed) return;

    try {
      if (ref.kind === "file") {
        const target = this.safeChild(dir, ref.label);
        if (!target) {
          this.messages.warn("Invalid resource name.");
          return;
        }
        await this.fileService.delete(target, { useTrash: false, recursive: false });
      } else {
        await this.removeLinkLine(dir.resolve("_links.md"), ref);
      }
      await this.refreshSpecResources();
      this.messages.info(`Removed "${ref.label}".`);
    } catch (err) {
      console.error("[spexr] removeSpecContext failed", err);
      this.messages.error(
        `Remove resource failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Drop the `- [label](href)` line matching the ref from a `_links.md` file. */
  private async removeLinkLine(linksUri: URI, ref: SpecResourceRef): Promise<void> {
    if (!(await this.exists(linksUri))) return;
    const current = await this.fileService.read(linksUri);
    const next = current.value
      .split("\n")
      .filter((line) => {
        const m = line.match(/^-\s*\[([^\]]+)\]\(([^)]+)\)/);
        return !(m && m[1] === ref.label && m[2] === ref.href);
      })
      .join("\n");
    if (next !== current.value) {
      await this.fileService.write(linksUri, next);
    }
  }

  /**
   * Resolve a filename against `dir`, returning the URI only when it stays a
   * direct child — a second guard against path traversal in the resource name.
   */
  private safeChild(dir: URI, filename: string): URI | undefined {
    const child = dir.resolve(filename);
    return child.parent.toString() === dir.toString() ? child : undefined;
  }

  /** Resolve the `.context/<slug>/` folder for the spec a resource belongs to. */
  private resourceContextDir(specUri: string): URI | undefined {
    const root = this.workspaceRoot();
    if (!root) return undefined;
    const slug = this.specSlug(new URI(specUri));
    return slug ? specContextDir(root, slug) : undefined;
  }

  private resolveResourceRef(raw: unknown): SpecResourceRef | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    const r = raw as Partial<SpecResourceRef>;
    if (typeof r.specUri !== "string" || typeof r.label !== "string") return undefined;
    if (r.kind !== "file" && r.kind !== "link") return undefined;
    // Reject path-traversal in the label — it is resolved against the context
    // dir to locate a file to open/delete, so it must be a bare filename.
    if (/[/\\\x00]/.test(r.label) || r.label === ".." || r.label === ".") return undefined;
    return {
      specUri: r.specUri,
      kind: r.kind,
      label: r.label,
      ...(typeof r.href === "string" ? { href: r.href } : {}),
    };
  }

  private async addContextFromFiles(contextDir: URI): Promise<void> {
    const picked = await this.fileDialog.showOpenDialog({
      title: "Pick context files for the spec",
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: true,
    });
    if (!picked) return;
    const sources = Array.isArray(picked) ? picked : [picked];
    if (sources.length === 0) return;

    const copied: string[] = [];
    for (const source of sources) {
      try {
        const buffer = await this.fileService.readFile(source);
        const target = await this.uniqueTarget(contextDir, source.path.base);
        await this.fileService.createFile(target, buffer.value, { overwrite: false });
        copied.push(target.path.base);
      } catch (err) {
        console.error("[spexr] addContextFromFiles failed for", source.toString(), err);
        this.messages.error(
          `Could not copy ${source.path.base}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (copied.length > 0) {
      this.messages.info(`Added ${copied.length} context file(s): ${copied.join(", ")}`);
    }
  }

  private async addContextFromUrl(contextDir: URI): Promise<void> {
    const url = await this.quickInput.input({
      prompt: "Context URL (https://…)",
      placeHolder: "https://example.com/brief",
      validateInput: (value) =>
        URL_RE.test(value.trim())
          ? Promise.resolve(undefined)
          : Promise.resolve("Enter a valid http(s) URL."),
    });
    if (!url) return;
    const label = await this.quickInput.input({
      prompt: "Short label (optional)",
      placeHolder: "Customer kickoff brief",
    });
    if (label === undefined) return;

    const linksUri = contextDir.resolve("_links.md");
    const today = new Date().toISOString().slice(0, 10);
    const display = label.trim().length > 0 ? label.trim() : url.trim();
    const line = `- [${display}](${url.trim()}) — ${today}\n`;
    await this.appendOrCreate(linksUri, "# Context links\n\n", line);
    this.messages.info(`Added link to ${linksUri.path.base}`);
  }

  private async appendOrCreate(uri: URI, header: string, line: string): Promise<void> {
    if (await this.exists(uri)) {
      const current = await this.fileService.read(uri);
      const next = current.value.endsWith("\n") ? current.value + line : current.value + "\n" + line;
      await this.fileService.write(uri, next);
      return;
    }
    await this.fileService.create(uri, header + line);
  }

  private async uniqueTarget(dir: URI, filename: string): Promise<URI> {
    let target = dir.resolve(filename);
    if (!(await this.exists(target))) return target;
    const dot = filename.lastIndexOf(".");
    const stem = dot > 0 ? filename.slice(0, dot) : filename;
    const ext = dot > 0 ? filename.slice(dot) : "";
    let i = 2;
    while (true) {
      target = dir.resolve(`${stem}-${i}${ext}`);
      if (!(await this.exists(target))) return target;
      i += 1;
    }
  }

  private async ensureDir(uri: URI): Promise<void> {
    if (!(await this.exists(uri))) {
      await this.fileService.createFolder(uri);
    }
  }

  private specSlug(uri: URI): string | undefined {
    const match = uri.path.base.match(SPEC_FILE_RE);
    if (!match) return undefined;
    return `${match[1]}-${match[2]}`;
  }

  isSpecUri(uri: URI | undefined): boolean {
    if (!uri) return false;
    const root = this.workspaceRoot();
    if (!root) return false;
    if (uri.scheme !== root.scheme) return false;
    const uriStr = uri.toString();
    const isUnderSpecs = allSpecsDirs(root).some((dir) => uriStr.startsWith(dir.toString() + "/"));
    return isUnderSpecs && SPEC_FILE_RE.test(uri.path.base);
  }

  resolveSpecUri(raw: unknown): URI | undefined {
    if (raw instanceof URI) return raw;
    if (typeof raw === "string") return new URI(raw);
    if (raw && typeof raw === "object") {
      const widget = raw as { getResourceUri?: () => URI | undefined };
      if (typeof widget.getResourceUri === "function") {
        return widget.getResourceUri();
      }
      const candidate = String(raw);
      if (candidate.startsWith("file:")) return new URI(candidate);
    }
    return undefined;
  }

  private async createSpec(): Promise<void> {
    try {
      const root = await this.resolveSpecTarget();
      if (!root) return;

      const slug = await this.quickInput.input({
        prompt: "Spec slug (lowercase, hyphens, e.g. user-onboarding)",
        placeHolder: "user-onboarding",
        validateInput: (value) =>
          SLUG_RE.test(value)
            ? Promise.resolve(undefined)
            : Promise.resolve("Use lowercase letters, digits, and hyphens only."),
      });
      if (!slug) return;

      const title = await this.quickInput.input({
        prompt: "Spec title (human-readable)",
        placeHolder: "User onboarding flow",
      });
      if (title === undefined) return;

      const number = await this.nextSpecNumber(root.uri);
      const padded = number.toString().padStart(4, "0");
      const filename = `${padded}-${slug}.md`;
      const fileUri = specsDir(root.uri).resolve(filename);
      const today = new Date().toISOString().slice(0, 10);
      const content = SPEC_TEMPLATE(`${padded}-${slug}`, title || slug, today);

      await this.scaffoldSpexrDir(root.uri);
      await this.fileService.create(fileUri, content, { overwrite: false });
      this.messages.info(`Created ${filename}`);

      if (root.openAfter) {
        this.workspace.open(root.uri);
      } else {
        await this.openSpec(fileUri);
      }
    } catch (err) {
      console.error("[spexr] createSpec failed", err);
      this.messages.error(
        `Create spec failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async resolveSpecTarget(): Promise<{ uri: URI; openAfter: boolean } | undefined> {
    const existing = this.workspaceRoot();
    if (existing) return { uri: existing, openAfter: false };

    const picked = await this.fileDialog.showOpenDialog({
      title: "Select folder to host the new spec",
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
    });
    if (!picked || Array.isArray(picked)) return undefined;
    return { uri: picked, openAfter: true };
  }

  private async newProject(): Promise<void> {
    const folder = await this.fileDialog.showOpenDialog({
      title: "Select folder for new SPEXR project",
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
    });
    if (!folder || Array.isArray(folder)) return;

    const target = folder;
    await this.scaffoldSpexrDir(target);
    await this.claudeTerminal.linkMemory(target.path.toString());
    await this.workspace.open(target);
  }

  private async scaffoldSpexrDir(root: URI): Promise<void> {
    const memDir = memoryDir(root);
    const spcsDir = specsDir(root);
    if (!(await this.exists(memDir))) {
      await this.fileService.createFolder(memDir);
    }
    if (!(await this.exists(spcsDir))) {
      await this.fileService.createFolder(spcsDir);
    }
    const indexUri = memDir.resolve("MEMORY.md");
    if (!(await this.exists(indexUri))) {
      await this.fileService.create(indexUri, "# MEMORY\n\nIndex of project memory entries.\n");
    }
    await this.seedDefaultExperts(root);
  }

  /**
   * Install the default expert personas (all catalog experts except the ones in
   * {@link DEFAULT_EXCLUDED_EXPERTS}) into `docs/agents/` on first scaffold.
   *
   * Only seeds when the agents directory does not yet exist, so personas the
   * user later removes are not silently re-created on the next scaffold call.
   */
  private async seedDefaultExperts(root: URI): Promise<void> {
    if (!this.agentService) return;
    const dir = agentsDir(root);
    if (await this.exists(dir)) return;
    try {
      const catalog = await this.agentService.listMarketplaceExperts();
      await this.ensureDir(dir);
      for (const e of catalog) {
        if (DEFAULT_EXCLUDED_EXPERTS.has(e.id)) continue;
        const fileUri = dir.resolve(`${e.id}.md`);
        await this.fileService.create(
          fileUri,
          serializeExpertFile({
            id: e.id,
            name: e.name,
            icon: e.icon,
            color: e.color,
            systemPrompt: e.systemPrompt,
            ...(e.model ? { model: e.model } : {}),
          }),
          { overwrite: false },
        );
      }
    } catch (err) {
      console.error("[spexr] seedDefaultExperts failed", err);
    }
  }

  private async exists(uri: URI): Promise<boolean> {
    try {
      await this.fileService.resolve(uri);
      return true;
    } catch {
      return false;
    }
  }

  private workspaceRoot(): URI | undefined {
    const roots = this.workspace.tryGetRoots();
    const first = roots[0];
    return first ? first.resource : undefined;
  }

  private async nextSpecNumber(root: URI): Promise<number> {
    const spcsDir = specsDir(root);
    try {
      const stat = await this.fileService.resolve(spcsDir);
      const used = (stat.children ?? [])
        .map((c) => c.name.match(/^(\d{4})-/)?.[1])
        .filter((s): s is string => Boolean(s))
        .map((s) => parseInt(s, 10));
      return used.length === 0 ? 1 : Math.max(...used) + 1;
    } catch {
      return 1;
    }
  }

  private async addMemory(): Promise<void> {
    try {
      const root = this.workspaceRoot();
      if (!root) {
        this.messages.warn("Open a workspace before adding a memory.");
        return;
      }

      const typeChoice = await this.quickInput.pick(
        MEMORY_TYPES.map((t) => ({ label: t, description: MEMORY_TYPE_DESCRIPTIONS[t] })),
        { placeHolder: "Pick the memory type" },
      );
      if (!typeChoice) return;
      const type = typeChoice.label as MemoryType;

      const name = await this.quickInput.input({
        prompt: "Memory name (short, human-readable)",
        placeHolder: "User role + preferences",
        validateInput: (value) =>
          value.trim().length > 0
            ? Promise.resolve(undefined)
            : Promise.resolve("Name cannot be empty."),
      });
      if (!name) return;

      const description = await this.quickInput.input({
        prompt: "One-line description (used to decide relevance later)",
        placeHolder: "Senior backend engineer, prefers terse review comments",
        validateInput: (value) =>
          value.trim().length > 0
            ? Promise.resolve(undefined)
            : Promise.resolve("Description cannot be empty."),
      });
      if (!description) return;

      await this.scaffoldSpexrDir(root);
      const memDir = memoryDir(root);
      const slug = this.slugify(name);
      const filename = `${type}-${slug}.md`;
      const fileUri = await this.uniqueTarget(memDir, filename);
      const content = MEMORY_TEMPLATE(name.trim(), description.trim(), type);
      await this.fileService.create(fileUri, content, { overwrite: false });

      await this.appendToMemoryIndex(memDir, {
        title: name.trim(),
        file: fileUri.path.base,
        hook: description.trim(),
      });

      this.messages.info(`Created memory ${fileUri.path.base}.`);
      await this.openMemory(fileUri);
    } catch (err) {
      console.error("[spexr] addMemory failed", err);
      this.messages.error(
        `Add memory failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async openMemory(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Open memory requires a file URI.");
      return;
    }
    try {
      await this.editorManager.open(uri, { mode: "activate", preview: false });
    } catch (err) {
      console.error("[spexr] openMemory failed", err);
      this.messages.error(
        `Open memory failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async deleteMemory(uri: URI | undefined): Promise<void> {
    if (!uri) {
      this.messages.warn("Delete memory requires a file URI.");
      return;
    }
    const filename = uri.path.base;
    const confirmed = await new ConfirmDialog({
      title: `Delete ${filename}?`,
      msg: "This removes the file and its MEMORY.md index entry. This cannot be undone.",
      ok: "Delete",
      cancel: "Cancel",
    }).open();
    if (!confirmed) return;

    try {
      await this.fileService.delete(uri, { useTrash: false, recursive: false });
      const root = this.workspaceRoot();
      if (root) {
        await this.removeFromMemoryIndex(memoryDir(root), filename);
      }
      this.messages.info(`Deleted memory ${filename}.`);
    } catch (err) {
      console.error("[spexr] deleteMemory failed", err);
      this.messages.error(
        `Delete memory failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  isMemoryUri(uri: URI | undefined): boolean {
    if (!uri) return false;
    const root = this.workspaceRoot();
    if (!root) return false;
    if (uri.scheme !== root.scheme) return false;
    const memoryRoot = memoryDir(root).toString() + "/";
    if (!uri.toString().startsWith(memoryRoot)) return false;
    return uri.path.base.endsWith(".md") && uri.path.base !== "MEMORY.md";
  }

  resolveMemoryUri(raw: unknown): URI | undefined {
    if (raw instanceof URI) return raw;
    if (typeof raw === "string") return new URI(raw);
    if (raw && typeof raw === "object") {
      const widget = raw as { getResourceUri?: () => URI | undefined };
      if (typeof widget.getResourceUri === "function") {
        return widget.getResourceUri();
      }
      const candidate = String(raw);
      if (candidate.startsWith("file:")) return new URI(candidate);
    }
    return undefined;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "entry";
  }

  private async appendToMemoryIndex(
    memoryDir: URI,
    entry: { title: string; file: string; hook: string },
  ): Promise<void> {
    const indexUri = memoryDir.resolve("MEMORY.md");
    const line = `- [${entry.title}](${entry.file}) — ${entry.hook}\n`;
    if (!(await this.exists(indexUri))) {
      await this.fileService.create(
        indexUri,
        `# MEMORY\n\nIndex of project memory entries.\n\n${line}`,
      );
      return;
    }
    const current = await this.fileService.read(indexUri);
    const body = current.value.endsWith("\n") ? current.value : current.value + "\n";
    await this.fileService.write(indexUri, body + line);
  }

  private async removeFromMemoryIndex(memoryDir: URI, filename: string): Promise<void> {
    const indexUri = memoryDir.resolve("MEMORY.md");
    if (!(await this.exists(indexUri))) return;
    const current = await this.fileService.read(indexUri);
    const linkPattern = `](${filename})`;
    const next = current.value
      .split("\n")
      .filter((line) => !line.includes(linkPattern))
      .join("\n");
    if (next !== current.value) {
      await this.fileService.write(indexUri, next);
    }
  }
}
