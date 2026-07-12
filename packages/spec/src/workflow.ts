import type {
  AcceptanceCriterion,
  DriftReport,
  SpecFrontmatter,
  SpecStatus,
  WorkflowStep,
} from "./types.js";
import { WORKFLOW_STEP_ORDER } from "./types.js";

/** A criterion whose text is only its `**AC-N**` label, i.e. the template stub. */
const PLACEHOLDER_CRITERION = /^\*\*[A-Za-z]+-\d+\*\*$/;

/**
 * Whether the spec carries at least one real acceptance criterion — used as the
 * "specify is done" signal. Empty bullets and the scaffold's `**AC-1**` stub do
 * not count, so a freshly created draft stays on the specify step.
 */
export function hasAuthoredAcceptanceCriteria(
  criteria: readonly AcceptanceCriterion[],
): boolean {
  return criteria.some((c) => {
    const text = c.text.trim();
    return text.length > 0 && !PLACEHOLDER_CRITERION.test(text);
  });
}

export type WorkflowStepState = "done" | "current" | "pending";

export interface WorkflowSignals {
  readonly hasAcceptanceCriteria: boolean;
  readonly hasContext: boolean;
  readonly hasClarifications: boolean;
  readonly hasPlan?: boolean;
  readonly driftReport?: DriftReport;
}

export interface WorkflowProgress {
  readonly currentStep: WorkflowStep | "done";
  readonly stateByStep: Record<WorkflowStep, WorkflowStepState>;
  readonly doneCount: number;
  readonly totalCount: number;
  readonly percent: number;
}

export interface WorkflowAction {
  readonly type: "command" | "agent-prompt";
  readonly commandId?: string;
  readonly promptTitle?: string;
  readonly promptBody?: string;
  readonly nextStatus?: SpecStatus;
  readonly nextWorkflowStep: WorkflowStep | null;
}

const STATUS_AT_OR_AFTER: Record<SpecStatus, number> = {
  draft: 0,
  ready: 1,
  "in-progress": 2,
  implemented: 3,
  validated: 4,
  shipped: 5,
  archived: 6,
};

/**
 * Compute the current workflow step for a spec, blending frontmatter signals
 * with filesystem heuristics. Explicit `workflowStep` always wins; otherwise
 * we derive from status + fs.
 */
export function resolveCurrentStep(
  frontmatter: Pick<SpecFrontmatter, "status" | "workflowStep">,
  signals: WorkflowSignals,
): WorkflowStep | "done" {
  if (frontmatter.status === "shipped" || frontmatter.status === "archived") return "done";

  // A draft cannot be past "specify" until real acceptance criteria exist — this
  // wins over a persisted workflowStep so a stale/placeholder spec is not shown
  // as already specified.
  if (frontmatter.status === "draft" && !signals.hasAcceptanceCriteria) return "specify";
  if (frontmatter.workflowStep) {
    // Once the plan is generated the workflow auto-advances to implement so the
    // stepper reflects the real state without a manual click.
    if (frontmatter.workflowStep === "plan" && signals.hasPlan === true) return "implement";
    return frontmatter.workflowStep;
  }

  const statusLevel = STATUS_AT_OR_AFTER[frontmatter.status];

  if (statusLevel >= STATUS_AT_OR_AFTER.validated) return "ship";
  if (statusLevel >= STATUS_AT_OR_AFTER.implemented) return validateOrShip(signals);
  if (statusLevel >= STATUS_AT_OR_AFTER["in-progress"]) return "implement";
  if (statusLevel >= STATUS_AT_OR_AFTER.ready) return "implement";

  if (!signals.hasContext) return "context";
  if (!signals.hasClarifications) return "clarify";
  return "plan";
}

function validateOrShip(signals: WorkflowSignals): WorkflowStep {
  if (!signals.driftReport) return "validate";
  const hasBlocker = signals.driftReport.findings.some((f) => f.severity === "block");
  return hasBlocker ? "validate" : "ship";
}

export function computeProgress(currentStep: WorkflowStep | "done"): WorkflowProgress {
  const totalCount = WORKFLOW_STEP_ORDER.length;
  if (currentStep === "done") {
    const stateByStep = Object.fromEntries(
      WORKFLOW_STEP_ORDER.map((s) => [s, "done" as WorkflowStepState]),
    ) as Record<WorkflowStep, WorkflowStepState>;
    return { currentStep, stateByStep, doneCount: totalCount, totalCount, percent: 100 };
  }

  const idx = WORKFLOW_STEP_ORDER.indexOf(currentStep);
  const stateByStep = Object.fromEntries(
    WORKFLOW_STEP_ORDER.map((s, i) => {
      const state: WorkflowStepState = i < idx ? "done" : i === idx ? "current" : "pending";
      return [s, state];
    }),
  ) as Record<WorkflowStep, WorkflowStepState>;

  const percent = Math.round((idx / totalCount) * 100);
  return { currentStep, stateByStep, doneCount: idx, totalCount, percent };
}

export const WORKFLOW_STEP_LABEL: Record<WorkflowStep, string> = {
  specify: "Specify",
  context: "Context",
  clarify: "Clarify",
  plan: "Plan",
  implement: "Implement",
  validate: "Validate",
  ship: "Ship",
};

/**
 * Default expert persona to activate when entering each workflow step.
 *
 * `null` means the base agent (no persona). When the mapped expert is not
 * installed under `docs/agents/`, callers fall back to the base agent.
 */
export const WORKFLOW_STEP_EXPERT: Record<WorkflowStep, string | null> = {
  specify: "brainstorming",
  context: "design",
  clarify: "brainstorming",
  plan: "design",
  implement: "software-engineering",
  validate: "review",
  ship: "marketing",
};

export const WORKFLOW_STEP_HINT: Record<WorkflowStep, string> = {
  specify: "Author goal, non-goals, acceptance criteria",
  context: "Attach reference files and links",
  clarify: "Resolve open AC questions with the agent",
  plan: "Draft plan steps linked to AC",
  implement: "Agent edits, you review the diff",
  validate: "Drift detector + tests check AC coverage",
  ship: "Open PR with `Spec: <slug>` trailer",
};

/**
 * Human-readable preview of what each step does when its button is clicked —
 * surfaced in the stepper tooltip so the user knows the prompt sent to the agent
 * before committing. `specify` and `context` open local UI instead of prompting
 * the agent; the rest hand a prompt off to the running session.
 */
export const WORKFLOW_STEP_PROMPT_PREVIEW: Record<WorkflowStep, string> = {
  specify:
    "Opens the spec in the editor so you can author the goal, non-goals, and acceptance criteria. No agent prompt is sent.",
  context:
    'Opens the "Add context" picker to attach local files or links under the spec context folder. No agent prompt is sent.',
  clarify:
    "Sends a prompt asking the agent to list 5–10 open questions on the acceptance criteria, propose an answer for each from available context, and write the Q&A to clarifications.md.",
  plan:
    "Sends a prompt asking the agent to draft an implementation plan — a table of step, description, AC covered, and files touched, plus a numbered task list. No code is written yet.",
  implement:
    "Sends a prompt telling the agent to execute the plan: edit files, reference AC IDs in each commit with a `Spec` trailer, and stop after each logical chunk for review.",
  validate:
    "Sends a prompt asking the agent to verify each acceptance criterion against the current code and run tests, plus the structural drift detector findings. Reports pass/fail per AC.",
  ship:
    "Sends a prompt asking the agent to draft a PR title and body (change summary, AC covered, test plan) ending with a `Spec` trailer. It does not push.",
};

/**
 * Status / workflowStep that should be persisted when the user clicks a step.
 * Clicking a step means "I am starting / re-entering this step now."
 */
const STEP_PERSISTED: Record<WorkflowStep, { status?: SpecStatus; workflowStep: WorkflowStep }> = {
  specify: { status: "draft", workflowStep: "specify" },
  context: { workflowStep: "context" },
  clarify: { workflowStep: "clarify" },
  plan: { workflowStep: "plan" },
  implement: { status: "in-progress", workflowStep: "implement" },
  validate: { status: "implemented", workflowStep: "validate" },
  ship: { status: "validated", workflowStep: "ship" },
};

export function persistedStateForStep(
  step: WorkflowStep,
): { status?: SpecStatus; workflowStep: WorkflowStep } {
  return STEP_PERSISTED[step];
}

export function effectiveCurrentStep(
  frontmatter: Pick<SpecFrontmatter, "status" | "workflowStep" | "forcedSteps">,
  signals: WorkflowSignals,
): WorkflowStep | "done" {
  const natural = resolveCurrentStep(frontmatter, signals);
  const forced = frontmatter.forcedSteps ?? [];
  if (forced.length === 0) return natural;
  const forcedIdx = WORKFLOW_STEP_ORDER.indexOf(forced[forced.length - 1]!);
  const naturalIdx = natural === "done" ? WORKFLOW_STEP_ORDER.length : WORKFLOW_STEP_ORDER.indexOf(natural);
  const idx = Math.max(naturalIdx, forcedIdx + 1);
  return idx >= WORKFLOW_STEP_ORDER.length ? "done" : WORKFLOW_STEP_ORDER[idx]!;
}

export interface ForceStepResult {
  readonly ok: boolean;
  readonly forcedSteps: readonly WorkflowStep[];
  readonly error?: string;
}

/**
 * Force the current step complete regardless of its auto-completion signal.
 * Only the step `effectiveCurrentStep` currently reports as current can be
 * forced — so each new entry is always the step immediately after the natural
 * step or the previous forced entry, keeping `forcedSteps` a monotonically
 * increasing run (not necessarily starting at `specify`, since natural
 * signals may already be ahead) with no separate predecessor check needed.
 */
export function forceCompleteStep(
  frontmatter: Pick<SpecFrontmatter, "status" | "workflowStep" | "forcedSteps">,
  signals: WorkflowSignals,
  step: WorkflowStep,
): ForceStepResult {
  const forced = frontmatter.forcedSteps ?? [];
  const current = effectiveCurrentStep(frontmatter, signals);
  if (step !== current) {
    const label = WORKFLOW_STEP_LABEL[step];
    return {
      ok: false,
      forcedSteps: forced,
      error:
        current === "done"
          ? `Cannot force "${label}" — spec is already complete.`
          : `Cannot force "${label}" — it is not the current step.`,
    };
  }
  return { ok: true, forcedSteps: [...forced, step] };
}

/** Undo a force — only the most recently forced step can be undone (stack). */
export function unforceStep(
  frontmatter: Pick<SpecFrontmatter, "forcedSteps">,
  step: WorkflowStep,
): ForceStepResult {
  const forced = frontmatter.forcedSteps ?? [];
  const last = forced[forced.length - 1];
  if (last !== step) {
    return {
      ok: false,
      forcedSteps: forced,
      error: `Cannot undo "${WORKFLOW_STEP_LABEL[step]}" — it is not the most recently forced step.`,
    };
  }
  return { ok: true, forcedSteps: forced.slice(0, -1) };
}

export interface EffectiveWorkflowProgress extends WorkflowProgress {
  readonly forcedSteps: readonly WorkflowStep[];
  /** Forced steps whose own auto-completion signal still hasn't fired — drives the stepper's warning icon. */
  readonly unverifiedForcedSteps: readonly WorkflowStep[];
}

export function computeEffectiveProgress(
  frontmatter: Pick<SpecFrontmatter, "status" | "workflowStep" | "forcedSteps">,
  signals: WorkflowSignals,
): EffectiveWorkflowProgress {
  const natural = resolveCurrentStep(frontmatter, signals);
  const naturalIdx = natural === "done" ? WORKFLOW_STEP_ORDER.length : WORKFLOW_STEP_ORDER.indexOf(natural);
  const forcedSteps = frontmatter.forcedSteps ?? [];
  const progress = computeProgress(effectiveCurrentStep(frontmatter, signals));
  const unverifiedForcedSteps = forcedSteps.filter(
    (step) => naturalIdx <= WORKFLOW_STEP_ORDER.indexOf(step),
  );
  return { ...progress, forcedSteps, unverifiedForcedSteps };
}
