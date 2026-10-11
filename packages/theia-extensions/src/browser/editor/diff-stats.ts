import { diffArrays } from "diff";
import type { DiffStats } from "./breadcrumb-model.js";
import { planDiff } from "./diff-budget.js";

/**
 * Lines added and removed going from `previous` to `current`, or undefined
 * when the difference is over the budget (diff-budget.ts). A line diff of the
 * lines that differ, summed: what `git diff --numstat` counts. (Theia's
 * DirtyDiff computation is not used: it files a region that starts or ends at
 * a blank line as a pure add or remove, which the gutter wants and a count
 * does not.)
 */
export function diffStats(previous: string, current: string): DiffStats | undefined {
  const plan = planDiff(previous, current);
  if (plan.kind === "stats") return plan.stats;
  if (plan.kind === "skip") return undefined;
  let added = 0;
  let removed = 0;
  for (const part of diffArrays(plan.previous, plan.current)) {
    if (part.added) added += part.count ?? part.value.length;
    else if (part.removed) removed += part.count ?? part.value.length;
  }
  return { added, removed };
}
