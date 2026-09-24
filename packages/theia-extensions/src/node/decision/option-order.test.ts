import { describe, expect, it } from "vitest";
import { averageChoices, rotations } from "./option-order.js";

describe("rotations", () => {
  it("gives the options in a few different orders, each option leading once", () => {
    expect(rotations(["a", "b", "c", "d", "e", "f"], 3)).toEqual([
      ["a", "b", "c", "d", "e", "f"],
      ["c", "d", "e", "f", "a", "b"],
      ["e", "f", "a", "b", "c", "d"],
    ]);
  });

  it("never asks the same order twice for a short list", () => {
    expect(rotations(["a", "b"], 3)).toEqual([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(rotations(["a"], 3)).toEqual([["a"]]);
  });
});

describe("averageChoices", () => {
  it("averages the probabilities of each ordering and picks the highest", () => {
    const d = averageChoices(
      ["se", "review"],
      [
        { se: 0.8, review: 0.2 },
        { se: 0.2, review: 0.8 },
        { se: 0.1, review: 0.9 },
      ],
    );
    expect(d.choice).toBe("review");
    expect(d.confidence).toBeCloseTo(0.6333, 3);
    expect(d.probabilities.se).toBeCloseTo(0.3667, 3);
  });

  it("keeps the first option on a tie, so the answer is deterministic", () => {
    expect(averageChoices(["a", "b"], [{ a: 0.5, b: 0.5 }]).choice).toBe("a");
  });
});
