import { DiffComputer } from "@theia/scm/lib/browser/dirty-diff/diff-computer";
import { ContentLines } from "@theia/scm/lib/browser/dirty-diff/content-lines";
import { foldDiffStats, type DiffStats } from "./breadcrumb-model.js";
import { planDiff } from "./diff-budget.js";

const computer = new DiffComputer();

/**
 * Lines added and removed going from `previous` to `current`, or undefined
 * when the difference is over the budget (diff-budget.ts). It is Theia's own
 * DirtyDiff computation (the one the gutter's bars use), folded with
 * {@link foldDiffStats}, run on the part of the texts that differs.
 */
export function diffStats(previous: string, current: string): DiffStats | undefined {
  const plan = planDiff(previous, current);
  if (plan.kind === "stats") return plan.stats;
  if (plan.kind === "skip") return undefined;
  const { changes } = computer.computeDirtyDiff(ContentLines.arrayLike(ContentLines.fromString(plan.previous)), ContentLines.arrayLike(ContentLines.fromString(plan.current)));
  return foldDiffStats(changes);
}
