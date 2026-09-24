import { describe, expect, it } from "vitest";
import type { Decision } from "../../common/decision-protocol.js";
import { routeTodo } from "./todo-routing.js";

const INSTALLED = ["software-engineering", "marketing", "review"];

function choice(pick: string, probabilities: Record<string, number>, model: "kev-4b" | "kev-0.6b" = "kev-4b"): Decision {
  return { type: "choice", choice: pick, confidence: probabilities[pick]!, probabilities, model };
}

describe("routeTodo", () => {
  it("hands the item over on its own when the model is sure enough", () => {
    const d = choice("marketing", { "software-engineering": 0.05, marketing: 0.9, review: 0.05 });
    expect(routeTodo(d, INSTALLED)).toEqual({ kind: "auto", expertId: "marketing", confidence: 0.9 });
  });

  it("asks when the model is unsure, most likely expert first and selected", () => {
    const d = choice("review", { "software-engineering": 0.4, marketing: 0.05, review: 0.55 });
    expect(routeTodo(d, INSTALLED)).toEqual({
      kind: "ask",
      options: [
        { id: "review", probability: 0.55 },
        { id: "software-engineering", probability: 0.4 },
        { id: "marketing", probability: 0.05 },
      ],
      preselect: "review",
    });
  });

  it("holds each model to its own threshold", () => {
    const probs = { "software-engineering": 0.75, marketing: 0.2, review: 0.05 };
    expect(routeTodo(choice("software-engineering", probs, "kev-4b"), INSTALLED).kind).toBe("auto");
    expect(routeTodo(choice("software-engineering", probs, "kev-0.6b"), INSTALLED).kind).toBe("ask");
  });

  it("never lets the light model act alone, however sure it says it is", () => {
    const d = choice("marketing", { "software-engineering": 0.005, marketing: 0.99, review: 0.005 }, "kev-0.6b");
    expect(routeTodo(d, INSTALLED)).toMatchObject({ kind: "ask", preselect: "marketing" });
  });

  it("asks without percentages when there is no decision", () => {
    expect(routeTodo(undefined, INSTALLED)).toEqual({
      kind: "ask",
      options: INSTALLED.map((id) => ({ id })),
    });
  });

  it("asks nothing when no expert is installed", () => {
    expect(routeTodo(undefined, [])).toEqual({ kind: "none" });
  });

  it("does not act on an answer that is not an installed expert", () => {
    const d = choice("design", { design: 0.99 });
    expect(routeTodo(d, INSTALLED).kind).toBe("ask");
  });
});
