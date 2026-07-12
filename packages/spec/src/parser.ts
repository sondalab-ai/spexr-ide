import { SpecError } from "@spexr/core/errors";
import { parseFrontmatter } from "./frontmatter.js";
import type {
  AcceptanceCriterion,
  Spec,
  SpecFrontmatter,
  SpecStatus,
  WorkflowStep,
} from "./types.js";
import { WORKFLOW_STEP_ORDER } from "./types.js";

const VALID_STATUSES: ReadonlySet<SpecStatus> = new Set([
  "draft",
  "ready",
  "in-progress",
  "implemented",
  "validated",
  "shipped",
  "archived",
]);

const VALID_WORKFLOW_STEPS: ReadonlySet<WorkflowStep> = new Set(WORKFLOW_STEP_ORDER);

/**
 * Parse a spec markdown file. Sections are matched by H2 heading; missing
 * sections produce empty arrays rather than throwing — drafts are allowed.
 */
export function parseSpec(raw: string, absolutePath: string): Spec {
  const parsed = parseFrontmatter(raw);
  const frontmatter = readFrontmatter(parsed.data);
  const sections = splitSections(parsed.content);

  return {
    frontmatter,
    absolutePath,
    goal: sections.get("goal") ?? "",
    nonGoals: parseBulletList(sections.get("non-goals") ?? sections.get("non goals") ?? ""),
    acceptanceCriteria: parseAcceptanceCriteria(
      sections.get("acceptance criteria") ?? sections.get("acceptance-criteria") ?? "",
    ),
    notes: sections.get("notes") ?? "",
    raw,
  };
}

function readFrontmatter(data: Record<string, unknown>): SpecFrontmatter {
  const slug = expectString(data, "slug");
  const title = expectString(data, "title");
  const status = expectString(data, "status");
  if (!VALID_STATUSES.has(status as SpecStatus)) {
    throw new SpecError(`Invalid spec status "${status}"`);
  }
  const workflowStepRaw = typeof data.workflowStep === "string" ? data.workflowStep : undefined;
  const workflowStep =
    workflowStepRaw && VALID_WORKFLOW_STEPS.has(workflowStepRaw as WorkflowStep)
      ? (workflowStepRaw as WorkflowStep)
      : undefined;

  return {
    slug,
    title,
    status: status as SpecStatus,
    ...(workflowStep ? { workflowStep } : {}),
    ...(typeof data.owner === "string" ? { owner: data.owner } : {}),
    ...(typeof data.createdAt === "string" ? { createdAt: data.createdAt } : {}),
    ...(typeof data.updatedAt === "string" ? { updatedAt: data.updatedAt } : {}),
    ...(Array.isArray(data.relatedSpecs)
      ? { relatedSpecs: data.relatedSpecs.filter((v): v is string => typeof v === "string") }
      : {}),
    ...(Array.isArray(data.forcedSteps)
      ? {
          forcedSteps: data.forcedSteps.filter(
            (v): v is WorkflowStep => typeof v === "string" && VALID_WORKFLOW_STEPS.has(v as WorkflowStep),
          ),
        }
      : {}),
  };
}

function expectString(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new SpecError(`Spec frontmatter "${key}" must be a non-empty string`);
  }
  return v;
}

const SECTION_RE = /^##\s+(.+?)\s*$/;

function splitSections(body: string): Map<string, string> {
  const lines = body.split(/\r?\n/);
  const sections = new Map<string, string>();
  let current: string | undefined;
  let buffer: string[] = [];
  for (const line of lines) {
    const m = SECTION_RE.exec(line);
    if (m) {
      if (current !== undefined) sections.set(current, buffer.join("\n").trim());
      current = m[1]!.toLowerCase();
      buffer = [];
    } else if (current !== undefined) {
      buffer.push(line);
    }
  }
  if (current !== undefined) sections.set(current, buffer.join("\n").trim());
  return sections;
}

const BULLET_RE = /^\s*[-*]\s+(.+?)\s*$/;

function parseBulletList(text: string): readonly string[] {
  const items: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = BULLET_RE.exec(line);
    if (m) items.push(m[1]!);
  }
  return items;
}

const CRITERION_RE = /^\s*[-*]\s+(?:\[([ xX])\]\s+)?(?:\*\*([A-Z]+-\d+)\*\*\s+)?(.+?)\s*$/;

function parseAcceptanceCriteria(text: string): readonly AcceptanceCriterion[] {
  const items: AcceptanceCriterion[] = [];
  let counter = 1;
  for (const line of text.split(/\r?\n/)) {
    const m = CRITERION_RE.exec(line);
    if (!m) continue;
    const id = m[2] ?? `AC-${counter++}`;
    items.push({ id, text: m[3]! });
  }
  return items;
}
