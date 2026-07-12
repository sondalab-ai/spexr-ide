import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import type { SpecStatus, WorkflowStep } from "./types.js";

export interface FrontmatterPatch {
  readonly status?: SpecStatus;
  readonly workflowStep?: WorkflowStep | null;
  readonly forcedSteps?: readonly WorkflowStep[] | null;
  readonly updatedAt?: string;
}

/**
 * Roundtrip a spec markdown file applying a frontmatter patch. Existing keys
 * are preserved; passing `workflowStep: null` removes the field.
 */
export function patchFrontmatter(raw: string, patch: FrontmatterPatch): string {
  const parsed = parseFrontmatter(raw);
  const data: Record<string, unknown> = { ...parsed.data };

  if (patch.status !== undefined) data.status = patch.status;
  if (patch.workflowStep === null) {
    delete data.workflowStep;
  } else if (patch.workflowStep !== undefined) {
    data.workflowStep = patch.workflowStep;
  }
  if (patch.forcedSteps === null) {
    delete data.forcedSteps;
  } else if (patch.forcedSteps !== undefined) {
    data.forcedSteps = patch.forcedSteps;
  }
  if (patch.updatedAt !== undefined) data.updatedAt = patch.updatedAt;

  return stringifyFrontmatter(parsed.content, data);
}
