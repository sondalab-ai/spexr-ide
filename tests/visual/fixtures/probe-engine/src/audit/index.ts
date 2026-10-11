import { P95_BUDGET_MS } from "../probe/resolve";

/** One finding of the audit: R blocks the build, A is advice. */
export interface Finding {
  readonly level: "R" | "A";
  readonly file: string;
  readonly line: number;
  readonly message: string;
}

/** Fails the run when a cached resolve is slower than its budget. */
export function checkBudget(p95: number): Finding[] {
  if (p95 <= P95_BUDGET_MS) return [];
  return [{ level: "R", file: "src/probe/resolve.ts", line: 50, message: `p95 ${p95} ms over ${P95_BUDGET_MS} ms` }];
}
