import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { lintSpec } from "./spec-lint.js";
import type { SpecLintFinding, SpecLintSeverity } from "./types.js";

const CLEAN = `---
slug: 0010-sample
title: Sample spec
status: draft
createdAt: 2026-06-03
---

## Goal

The system shows a clear outcome to the user.

## Non-goals

- Does not change the database schema.

## Acceptance Criteria

- **AC-1** The panel renders findings grouped by severity when a spec is open.

## Notes

Some notes.
`;

const OPTS = { filename: "0010-sample.md" } as const;

/** 1-based line of the first row containing `needle`, so expectations track the fixture. */
function lineOf(raw: string, needle: string): number {
  return raw.split("\n").findIndex((l) => l.includes(needle)) + 1;
}

function has(
  findings: readonly SpecLintFinding[],
  severity: SpecLintSeverity,
  re: RegExp,
): boolean {
  return findings.some((f) => f.severity === severity && re.test(f.message));
}

describe("lintSpec", () => {
  it("is silent on a clean spec", () => {
    const report = lintSpec(CLEAN, OPTS);
    expect(report.findings).toEqual([]);
    expect(report.errorCount).toBe(0);
    expect(report.warnCount).toBe(0);
    expect(report.infoCount).toBe(0);
  });

  // AC-1: parse-failure tolerance.
  it("never throws and yields a finding when frontmatter is missing", () => {
    const report = lintSpec("## Goal\n\nNo frontmatter here.\n", OPTS);
    expect(has(report.findings, "error", /frontmatter/i)).toBe(true);
  });

  // AC-2: placeholder / scaffold checks.
  it("flags unsubstituted scaffold text", () => {
    const raw = CLEAN.replace(
      "The system shows a clear outcome to the user.",
      "Describe the user-facing outcome this spec delivers.",
    );
    expect(has(lintSpec(raw, OPTS).findings, "warn", /scaffold text/i)).toBe(true);
  });

  it("flags TODO/TBD markers", () => {
    const raw = CLEAN.replace("Some notes.", "TODO: write the notes.");
    expect(has(lintSpec(raw, OPTS).findings, "warn", /TBD\/TODO/)).toBe(true);
  });

  it("flags an empty bullet", () => {
    const raw = CLEAN.replace("- Does not change the database schema.", "-");
    expect(has(lintSpec(raw, OPTS).findings, "warn", /empty bullet/i)).toBe(true);
  });

  it("flags a leftover scaffold comment", () => {
    const raw = CLEAN.replace("Some notes.", "<!-- One bullet per criterion -->");
    expect(has(lintSpec(raw, OPTS).findings, "warn", /scaffold comment/i)).toBe(true);
  });

  // AC-3: missing / empty sections.
  it("flags an empty Goal", () => {
    const raw = CLEAN.replace("The system shows a clear outcome to the user.", "");
    expect(has(lintSpec(raw, OPTS).findings, "warn", /goal section is empty/i)).toBe(true);
  });

  it("flags a Non-goals section with no entries", () => {
    const raw = CLEAN.replace("- Does not change the database schema.", "");
    expect(has(lintSpec(raw, OPTS).findings, "warn", /non-goals/i)).toBe(true);
  });

  it("does not flag a scaffold string the spec is quoting", () => {
    const raw = CLEAN.replace(
      "The system shows a clear outcome to the user.",
      'The validator flags the scaffold string "Describe the user-facing outcome this spec delivers." when it survives.',
    );
    expect(has(lintSpec(raw, OPTS).findings, "warn", /scaffold/i)).toBe(false);
  });

  it("does not flag a TBD/TODO marker the spec is quoting", () => {
    const raw = CLEAN.replace(
      "The system shows a clear outcome to the user.",
      "The validator flags `TBD`/`TODO` markers left in a draft.",
    );
    expect(has(lintSpec(raw, OPTS).findings, "warn", /placeholder marker/i)).toBe(false);
  });

  it("flags zero acceptance criteria", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      "",
    );
    expect(has(lintSpec(raw, OPTS).findings, "warn", /no authored acceptance criteria/i)).toBe(true);
  });

  // AC-4: malformed acceptance criteria.
  it("flags duplicate ids as errors", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      "- **AC-1** The panel renders findings.\n- **AC-1** A second criterion appears.",
    );
    expect(has(lintSpec(raw, OPTS).findings, "error", /duplicate id AC-1/i)).toBe(true);
  });

  it("flags an AC bullet without an id", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      "- The panel renders findings grouped by severity when a spec is open.",
    );
    expect(has(lintSpec(raw, OPTS).findings, "warn", /no \*\*AC-N\*\* id/i)).toBe(true);
  });

  it("flags non-sequential numbering", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      "- **AC-3** The panel renders findings grouped by severity when a spec is open.",
    );
    expect(has(lintSpec(raw, OPTS).findings, "warn", /non-sequential/i)).toBe(true);
  });

  it("accepts the `**AC-1 Title.**` label form and keeps the title in the text", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      "- **AC-1 Findings panel.** The panel renders findings grouped by severity.",
    );
    expect(lintSpec(raw, OPTS).findings).toEqual([]);
  });

  it("treats indented bullets as details of the criterion above, not criteria", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      [
        "- **AC-1 Findings panel.** The panel renders findings grouped by severity:",
        "  - errors first, then warnings.",
        "  - each row reveals its line in the editor.",
      ].join("\n"),
    );
    expect(lintSpec(raw, OPTS).findings).toEqual([]);
  });

  it("does not read a cross-reference in the prose as the bullet's own id", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      "- The panel renders findings exactly as **AC-1** requires.",
    );
    const findings = lintSpec(raw, OPTS).findings;
    expect(has(findings, "warn", /no \*\*AC-N\*\* id/i)).toBe(true);
    expect(has(findings, "error", /duplicate/i)).toBe(false);
  });

  it("reports one misplaced id once instead of shifting every id after it", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      [
        "- **AC-1** The panel renders findings grouped by severity.",
        "- **AC-3** The panel reveals the line of a finding when clicked.",
        "- **AC-4** The panel shows a neutral state when no spec is open.",
        "- **AC-2** The panel refreshes when the editor content changes.",
      ].join("\n"),
    );
    const nonSequential = lintSpec(raw, OPTS).findings.filter((f) =>
      /non-sequential/i.test(f.message),
    );
    expect(nonSequential.map((f) => f.message)).toEqual([
      "Non-sequential id AC-3 (expected AC-2).",
      "Non-sequential id AC-2 (expected AC-5).",
    ]);
  });

  it("judges an AC by its whole paragraph, not by its first line", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      "- **AC-1 Registry.** `harness-registry.ts` exports\n  `installedHarnesses`, and returns the active harness.",
    );
    expect(lintSpec(raw, OPTS).findings).toEqual([]);
  });

  it("names where a skipped id is actually declared, instead of a position", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      [
        "- **AC-1** The panel renders findings grouped by severity.",
        "- **AC-3** The panel shows a neutral state when no spec is open.",
        "- **AC-2** The panel reveals the line of a finding when clicked.",
      ].join("\n"),
    );
    const findings = lintSpec(raw, OPTS).findings.filter((f) => /non-sequential/i.test(f.message));
    expect(findings[0]!.suggestion).toBe(
      `AC-2 is declared further down at L${lineOf(raw, "**AC-2**")} — move that criterion up to here.`,
    );
  });

  it("states an out-of-order fix against its own neighbour, never an id that does not exist", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      [
        "- **AC-1** The panel renders findings grouped by severity.",
        "- **AC-2** The panel reveals the line of a finding when clicked.",
        "- **AC-4** The panel refreshes when the editor content changes.",
        "- **AC-3** The panel shows a neutral state when no spec is open.",
      ].join("\n"),
    );
    const findings = lintSpec(raw, OPTS).findings.filter((f) => /non-sequential/i.test(f.message));
    const last = findings.at(-1)!;
    expect(last.message).toBe("Non-sequential id AC-3 (expected AC-5).");
    expect(last.suggestion).toBe(
      `Move it back to follow AC-2 (L${lineOf(raw, "**AC-2**")}), or renumber it to AC-5 to leave it where it is.`,
    );
  });

  it("falls back to a renumber when the skipped criterion is nowhere in the file", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      "- **AC-3** The panel renders findings grouped by severity.",
    );
    const findings = lintSpec(raw, OPTS).findings.filter((f) => /non-sequential/i.test(f.message));
    expect(findings[0]!.suggestion).toBe(
      "Renumber this criterion to AC-1, or add the criterion the numbering skips.",
    );
  });

  it("flags a vague AC as info", () => {
    const raw = CLEAN.replace(
      "- **AC-1** The panel renders findings grouped by severity when a spec is open.",
      "- **AC-1** Better UX.",
    );
    expect(has(lintSpec(raw, OPTS).findings, "info", /verifiable predicate/i)).toBe(true);
  });

  // AC-5: frontmatter coherence.
  it("flags invalid status, slug mismatch, and empty title as errors", () => {
    const raw = `---
slug: wrong-slug
title:
status: bogus
---

## Goal

A goal that is present.

## Acceptance Criteria

- **AC-1** The system does a verifiable thing when triggered.
`;
    const findings = lintSpec(raw, OPTS).findings;
    expect(has(findings, "error", /invalid status/i)).toBe(true);
    expect(has(findings, "error", /does not match filename stem/i)).toBe(true);
    expect(has(findings, "error", /title.*empty/i)).toBe(true);
  });

  it("flags a relatedSpecs entry with no matching spec", () => {
    const raw = CLEAN.replace(
      "createdAt: 2026-06-03",
      "createdAt: 2026-06-03\nrelatedSpecs: [0001-bootstrap, 9999-ghost]",
    );
    const findings = lintSpec(raw, { ...OPTS, knownSlugs: ["0001-bootstrap"] }).findings;
    expect(has(findings, "warn", /9999-ghost/)).toBe(true);
    expect(has(findings, "warn", /0001-bootstrap/)).toBe(false);
  });

  // Real spec sanity: a shipped/real spec has no error-level findings.
  it("yields zero error findings on a real spec (0008)", () => {
    const path = fileURLToPath(new URL("../../../docs/specs/0008-plan-task-artifacts.md", import.meta.url));
    const raw = readFileSync(path, "utf8");
    const report = lintSpec(raw, { filename: "0008-plan-task-artifacts.md" });
    expect(report.errorCount).toBe(0);
  });
});
