import { describe, expect, it } from "vitest";
import { buildSpecLintFixPrompt, type SpecLintFixFinding } from "./spec-lint-fix.js";

const FINDINGS: readonly SpecLintFixFinding[] = [
  {
    severity: "warn",
    section: "Acceptance Criteria",
    message: "Non-sequential id AC-20 (expected AC-19).",
    suggestion: "Either renumber this criterion to AC-19, or move it to where AC-19 belongs.",
    line: 215,
    sourceLine: "- **AC-20 Push channel.** `git-protocol.ts` exports",
  },
  {
    severity: "error",
    section: "Frontmatter",
    message: 'Invalid status "done".',
  },
];

const PATH = "docs/specs/0014-git-hardening.md";

describe("buildSpecLintFixPrompt", () => {
  it("points the agent at the file instead of pasting its content", () => {
    const prompt = buildSpecLintFixPrompt({ path: PATH, findings: FINDINGS });
    expect(prompt.startsWith(`Fix the spec validation findings in \`${PATH}\`.`)).toBe(true);
    expect(prompt).toContain("Read the file, then edit it in place.");
    expect(prompt).toContain("do not change code or tests");
  });

  it("quotes the source line and the suggestion under each finding", () => {
    const prompt = buildSpecLintFixPrompt({ path: PATH, findings: FINDINGS });
    expect(prompt).toContain(
      "1. [warning] Acceptance Criteria, line 215 — Non-sequential id AC-20 (expected AC-19).",
    );
    expect(prompt).toContain("   > - **AC-20 Push channel.** `git-protocol.ts` exports");
    expect(prompt).toContain(
      "   Suggested fix: Either renumber this criterion to AC-19, or move it to where AC-19 belongs.",
    );
  });

  it("omits the anchor and quote for a finding that has neither", () => {
    const prompt = buildSpecLintFixPrompt({ path: PATH, findings: FINDINGS });
    expect(prompt).toContain('2. [error] Frontmatter — Invalid status "done".');
    expect(prompt).not.toContain("Frontmatter, line");
  });

  it("counts the findings it lists", () => {
    expect(buildSpecLintFixPrompt({ path: PATH, findings: FINDINGS })).toContain("Findings (2):");
  });
});
