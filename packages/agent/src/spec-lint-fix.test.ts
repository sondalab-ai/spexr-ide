import { describe, expect, it } from "vitest";
import type { SpecLintFinding } from "@spexr/spec";
import { buildSpecLintFixPrompt } from "./spec-lint-fix.js";

const FINDINGS: readonly SpecLintFinding[] = [
  {
    severity: "warn",
    section: "Acceptance Criteria",
    message: "Non-sequential id AC-20 (expected AC-19).",
    line: 215,
  },
  {
    severity: "error",
    section: "Frontmatter",
    message: 'Invalid status "done".',
    suggestion: "Use one of: draft, ready, in-progress.",
  },
];

describe("buildSpecLintFixPrompt", () => {
  it("lists every finding with its severity, anchor and suggestion", () => {
    const prompt = buildSpecLintFixPrompt({
      slug: "0014-git-hardening",
      specBody: "## Goal\n\nHarden git.",
      findings: FINDINGS,
    });
    expect(prompt).toContain("Findings (2):");
    expect(prompt).toContain(
      "- [warning] Acceptance Criteria L215: Non-sequential id AC-20 (expected AC-19).",
    );
    expect(prompt).toContain(
      '- [error] Frontmatter: Invalid status "done". Suggested fix: Use one of: draft, ready, in-progress.',
    );
  });

  it("names the spec file and fences the task to it", () => {
    const prompt = buildSpecLintFixPrompt({
      slug: "0014-git-hardening",
      specBody: "## Goal\n\nHarden git.",
      findings: FINDINGS,
    });
    expect(prompt.startsWith("Fix the spec validation findings on `0014-git-hardening.md`.")).toBe(
      true,
    );
    expect(prompt).toContain("do not change code or tests");
  });

  it("ends with the spec body after a separator", () => {
    const prompt = buildSpecLintFixPrompt({
      slug: "0014-git-hardening",
      specBody: "## Goal\n\nHarden git.",
      findings: FINDINGS,
    });
    expect(prompt.endsWith("\n---\n\n## Goal\n\nHarden git.")).toBe(true);
  });
});
