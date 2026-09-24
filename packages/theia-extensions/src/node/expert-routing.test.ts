import { describe, expect, it } from "vitest";
import { buildRoutePrompt, expertForLabel, parseRouteAnswer } from "./expert-routing.js";

const ALL = ["software-engineering", "review", "design", "brainstorming", "marketing", "changelog-writer", "dri"];

describe("buildRoutePrompt", () => {
  it("gives the model the task alone, to label", () => {
    expect(buildRoutePrompt("Fix the pinned card height")).toBe("Task: Fix the pinned card height\nLabel:");
  });

  it("keeps a long task to its first lines, so a pasted log does not drown it", () => {
    const task = "Fix the freeze\n" + "log line\n".repeat(200);
    expect(buildRoutePrompt(task).length).toBeLessThan(700);
  });
});

describe("expertForLabel", () => {
  it("maps every label to the expert that does that kind of work", () => {
    expect(expertForLabel("bug")).toBe("software-engineering");
    expect(expertForLabel("code")).toBe("software-engineering");
    expect(expertForLabel("review")).toBe("review");
    expect(expertForLabel("design")).toBe("design");
    expect(expertForLabel("explore")).toBe("brainstorming");
    expect(expertForLabel("marketing")).toBe("marketing");
    expect(expertForLabel("release-notes")).toBe("changelog-writer");
    expect(expertForLabel("status")).toBe("dri");
  });

  it("understands the labels a small model makes up instead", () => {
    expect(expertForLabel("feature")).toBe("software-engineering");
    expect(expertForLabel("launch-notes")).toBe("marketing");
    expect(expertForLabel("changelog")).toBe("changelog-writer");
    expect(expertForLabel("crash fix")).toBe("software-engineering");
  });

  it("has no expert for an answer it cannot read", () => {
    expect(expertForLabel("banana")).toBeUndefined();
  });
});

describe("parseRouteAnswer", () => {
  it("returns the expert for the label, among the candidates", () => {
    expect(parseRouteAnswer(" Marketing. ", ALL)).toBe("marketing");
    expect(parseRouteAnswer("Label: bug", ALL)).toBe("software-engineering");
  });

  it("has no expert when the one for that label is not installed", () => {
    expect(parseRouteAnswer("marketing", ["software-engineering"])).toBeUndefined();
  });

  it("has no expert for no answer", () => {
    expect(parseRouteAnswer(null, ALL)).toBeUndefined();
    expect(parseRouteAnswer("", ALL)).toBeUndefined();
  });
});
