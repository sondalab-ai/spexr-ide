/**
 * Spec model. A spec is the contract; the plan and task list are derived
 * artifacts. Code changes link back via `Spec: <slug>` trailer in commits.
 */

export type SpecStatus =
  | "draft"
  | "ready"
  | "in-progress"
  | "implemented"
  | "validated"
  | "shipped"
  | "archived";

export type WorkflowStep =
  | "specify"
  | "context"
  | "clarify"
  | "plan"
  | "implement"
  | "validate"
  | "ship";

export const WORKFLOW_STEP_ORDER: readonly WorkflowStep[] = [
  "specify",
  "context",
  "clarify",
  "plan",
  "implement",
  "validate",
  "ship",
];

export interface SpecFrontmatter {
  readonly slug: string;
  readonly title: string;
  readonly owner?: string;
  readonly status: SpecStatus;
  readonly workflowStep?: WorkflowStep;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly relatedSpecs?: readonly string[];
  readonly forcedSteps?: readonly WorkflowStep[];
}

export interface AcceptanceCriterion {
  readonly id: string;
  readonly text: string;
}

export interface Spec {
  readonly frontmatter: SpecFrontmatter;
  readonly absolutePath: string;
  readonly goal: string;
  readonly nonGoals: readonly string[];
  readonly acceptanceCriteria: readonly AcceptanceCriterion[];
  readonly notes: string;
  readonly raw: string;
}

export interface PlanStep {
  readonly id: string;
  readonly summary: string;
  readonly affects: readonly string[];
  readonly criteriaCovered: readonly string[];
}

export interface SpecPlan {
  readonly specSlug: string;
  readonly steps: readonly PlanStep[];
}

export interface SpecTask {
  readonly id: string;
  readonly planStepId: string;
  readonly description: string;
  readonly status: "pending" | "in-progress" | "done" | "blocked";
}

export interface DriftFinding {
  readonly criterionId: string;
  readonly severity: "info" | "warn" | "block";
  readonly message: string;
  readonly suggestion?: string;
}

export interface DriftReport {
  readonly specSlug: string;
  readonly checkedAt: string;
  readonly findings: readonly DriftFinding[];
}

export type SpecLintSeverity = "error" | "warn" | "info";

export type SpecLintSection =
  | "Frontmatter"
  | "Goal"
  | "Non-goals"
  | "Acceptance Criteria"
  | "Notes"
  | "Document";

/**
 * A single spec-validation finding. Mirrors {@link DriftFinding} for a
 * consistent findings vocabulary across lint and drift, but carries a section
 * anchor and an optional 1-based line for editor navigation.
 */
export interface SpecLintFinding {
  readonly severity: SpecLintSeverity;
  readonly section: SpecLintSection;
  readonly message: string;
  readonly suggestion?: string;
  /** 1-based line in the raw source; omitted when the rule has no line. */
  readonly line?: number;
}

export interface SpecLintReport {
  readonly findings: readonly SpecLintFinding[];
  readonly errorCount: number;
  readonly warnCount: number;
  readonly infoCount: number;
}

export interface SpecRegistry {
  list(): Promise<readonly Spec[]>;
  get(slug: string): Promise<Spec>;
  save(slug: string, content: string): Promise<Spec>;
}
