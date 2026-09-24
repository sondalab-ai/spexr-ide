import { describe, expect, it } from "vitest";
import { buildRoutePrompt, parseRouteAnswer, type ExpertCandidate } from "./expert-routing.js";

const EXPERTS: ExpertCandidate[] = [
  { id: "software-engineering", name: "Software Engineering", description: "Implements and fixes code." },
  { id: "design", name: "Design", description: "Designs architectures and interfaces." },
  { id: "marketing", name: "Marketing", description: "Positioning, copy and launch material." },
];

describe("buildRoutePrompt", () => {
  it("lists every candidate by id with its description, then the task", () => {
    const prompt = buildRoutePrompt("Fix the pinned card height", EXPERTS);
    expect(prompt).toContain("- software-engineering: Implements and fixes code.");
    expect(prompt).toContain("- design: Designs architectures and interfaces.");
    expect(prompt).toContain("Task: Fix the pinned card height");
    expect(prompt.indexOf("Task:")).toBeGreaterThan(prompt.indexOf("- marketing"));
  });

  it("keeps a long task to its first lines, so a pasted log does not drown the list", () => {
    const task = "Fix the freeze\n" + "log line\n".repeat(200);
    expect(buildRoutePrompt(task, EXPERTS).length).toBeLessThan(1500);
  });
});

describe("parseRouteAnswer", () => {
  it("accepts a bare id", () => {
    expect(parseRouteAnswer("design", EXPERTS)).toBe("design");
  });

  it("tolerates the usual noise around it", () => {
    expect(parseRouteAnswer(" `Software-Engineering`. ", EXPERTS)).toBe("software-engineering");
    expect(parseRouteAnswer("Answer: marketing", EXPERTS)).toBe("marketing");
    expect(parseRouteAnswer("Design", EXPERTS)).toBe("design");
  });

  it("accepts an expert's display name", () => {
    expect(parseRouteAnswer("Software Engineering", EXPERTS)).toBe("software-engineering");
  });

  it("means no expert for none, nothing, or an id that is not a candidate", () => {
    expect(parseRouteAnswer("none", EXPERTS)).toBeUndefined();
    expect(parseRouteAnswer(null, EXPERTS)).toBeUndefined();
    expect(parseRouteAnswer("security-audit", EXPERTS)).toBeUndefined();
  });

  it("refuses an answer that names more than one candidate", () => {
    expect(parseRouteAnswer("design or marketing", EXPERTS)).toBeUndefined();
  });
});
