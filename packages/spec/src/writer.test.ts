import { describe, expect, it } from "vitest";
import { patchFrontmatter } from "./writer.js";

const SAMPLE = `---
slug: 0001-foo
title: Foo
status: draft
---

## Goal

Body.
`;

describe("patchFrontmatter", () => {
  it("updates status", () => {
    const next = patchFrontmatter(SAMPLE, { status: "ready" });
    expect(next).toMatch(/status: ready/);
    expect(next).toMatch(/## Goal\n\nBody\./);
  });

  it("adds workflowStep when not present", () => {
    const next = patchFrontmatter(SAMPLE, { workflowStep: "plan" });
    expect(next).toMatch(/workflowStep: plan/);
  });

  it("removes workflowStep when null", () => {
    const withStep = patchFrontmatter(SAMPLE, { workflowStep: "plan" });
    const removed = patchFrontmatter(withStep, { workflowStep: null });
    expect(removed).not.toMatch(/workflowStep:/);
  });

  it("preserves unrelated fields", () => {
    const next = patchFrontmatter(SAMPLE, { workflowStep: "ship", updatedAt: "2026-05-11" });
    expect(next).toMatch(/slug: 0001-foo/);
    expect(next).toMatch(/title: Foo/);
    expect(next).toMatch(/updatedAt: 2026-05-11/);
  });

  it("preserves body verbatim", () => {
    const next = patchFrontmatter(SAMPLE, { status: "ready" });
    expect(next.endsWith("## Goal\n\nBody.\n")).toBe(true);
  });

  it("adds forcedSteps as an array", () => {
    const next = patchFrontmatter(SAMPLE, { forcedSteps: ["specify", "context"] });
    expect(next).toMatch(/forcedSteps: \[specify, context\]/);
  });

  it("removes forcedSteps when null", () => {
    const withForced = patchFrontmatter(SAMPLE, { forcedSteps: ["plan"] });
    const removed = patchFrontmatter(withForced, { forcedSteps: null });
    expect(removed).not.toMatch(/forcedSteps:/);
  });
});
