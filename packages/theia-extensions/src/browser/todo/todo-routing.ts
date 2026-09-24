import { AUTO_DECISION_THRESHOLD, type Decision } from "../../common/decision-protocol.js";

/** What "Work on this" does with a TODO item once the decision is in (spec 0017). */
export type TodoRoute =
  /** No expert installed in the folder: send to the agent as it is. */
  | { readonly kind: "none" }
  /** The model is sure enough: send to this expert without asking. */
  | { readonly kind: "auto"; readonly expertId: string; readonly confidence: number }
  /**
   * Ask the user. Options are ordered by probability when the model gave one
   * (and carry it), in installed order otherwise; `preselect` is the model's
   * pick, absent when there was no decision.
   */
  | {
      readonly kind: "ask";
      readonly options: readonly { readonly id: string; readonly probability?: number }[];
      readonly preselect?: string;
    };

/**
 * Route a TODO item: hand it over on its own when the model's pick is an
 * installed expert at or above that model's threshold, otherwise ask with the
 * experts ranked by the model's probabilities.
 */
export function routeTodo(decision: Decision | undefined, installed: readonly string[]): TodoRoute {
  if (installed.length === 0) return { kind: "none" };
  if (decision?.type !== "choice") return { kind: "ask", options: installed.map((id) => ({ id })) };
  const threshold = AUTO_DECISION_THRESHOLD[decision.model];
  if (installed.includes(decision.choice) && decision.confidence >= threshold) {
    return { kind: "auto", expertId: decision.choice, confidence: decision.confidence };
  }
  const options = installed
    .map((id) => ({ id, probability: decision.probabilities[id] ?? 0 }))
    .sort((a, b) => b.probability - a.probability);
  return installed.includes(decision.choice)
    ? { kind: "ask", options, preselect: decision.choice }
    : { kind: "ask", options };
}
