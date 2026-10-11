import { diffArrays } from "diff";
import type { DiffStats } from "./breadcrumb-model.js";
import { planDiff } from "./diff-budget.js";

/**
 * Lines added and removed going from `previous` to `current`, or undefined
 * when the difference is over the budget (diff-budget.ts). A line diff of the
 * lines that differ, summed: what `git diff --numstat` counts. (Theia's
 * DirtyDiff computation is not used: it files a region that starts or ends at
 * a blank line as a pure add or remove, which the gutter wants and a count
 * does not.) Two things differ from numstat: a file's missing final newline
 * and a CRLF-to-LF change read as no difference (the lines are compared
 * without their ends), where numstat counts them.
 */
/** The longest the line diff may run on the UI thread, in ms (jsdiff's `timeout`, which its types do not list). */
export const DIFF_TIMEOUT_MS = 50;

const DIFF_OPTIONS = { timeout: DIFF_TIMEOUT_MS } as unknown as Parameters<typeof diffArrays>[2];

export function diffStats(previous: string, current: string): DiffStats | undefined {
  const plan = planDiff(previous, current);
  if (plan.kind === "stats") return plan.stats;
  if (plan.kind === "skip") return undefined;
  const parts = diffArrays(plan.previous, plan.current, DIFF_OPTIONS);
  // jsdiff gives up with undefined when the time is up: no stat, as over the budget.
  if (!parts) return undefined;
  let added = 0;
  let removed = 0;
  for (const part of parts) {
    if (part.added) added += part.count ?? part.value.length;
    else if (part.removed) removed += part.count ?? part.value.length;
  }
  return { added, removed };
}
