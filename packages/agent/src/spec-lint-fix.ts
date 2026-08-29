import type { SpecLintFinding, SpecLintSeverity } from "@spexr/spec";

/** Severity words the agent reads, spelled out rather than abbreviated. */
const SEVERITY_LABEL: Record<SpecLintSeverity, string> = {
  error: "error",
  warn: "warning",
  info: "info",
};

/** A finding plus the source line it anchors to, when the rule has one. */
export interface SpecLintFixFinding extends SpecLintFinding {
  readonly sourceLine?: string;
}

export interface SpecLintFixInput {
  /** Workspace-relative path, e.g. `docs/specs/0014-git-hardening.md`. */
  readonly path: string;
  /** Findings the validator is currently reporting for that spec. */
  readonly findings: readonly SpecLintFixFinding[];
}

/**
 * Assemble the agent message that asks for a spec's validation findings to be
 * fixed.
 *
 * The spec is referenced by path rather than pasted in: the agent has to edit
 * that file, and a copy in the prompt would leave the line anchors pointing at
 * nothing it can see. Each finding instead carries its own source line, so the
 * anchor is legible without counting lines. The rules fence the task to the
 * document — a validator finding is a defect in the writing, never a reason to
 * touch code, drop a criterion, or rewrite what was not flagged.
 */
export function buildSpecLintFixPrompt(input: SpecLintFixInput): string {
  const { path, findings } = input;
  return [
    `Fix the spec validation findings in \`${path}\`. Read the file, then edit it in place.`,
    "",
    "Rules:",
    "- Edit only that file. These are defects in the document — do not change code or tests.",
    "- Preserve the meaning of every acceptance criterion: renumber, relabel or reword it, never drop or invent one.",
    "- When an id changes, update every reference to it in the same file.",
    "- Leave anything the validator did not report untouched.",
    "",
    `Findings (${findings.length}):`,
    "",
    findings.map(formatFinding).join("\n\n"),
  ].join("\n");
}

function formatFinding(finding: SpecLintFixFinding, index: number): string {
  const where =
    finding.line === undefined ? finding.section : `${finding.section}, line ${finding.line}`;
  const out = [
    `${index + 1}. [${SEVERITY_LABEL[finding.severity]}] ${where} — ${finding.message}`,
  ];
  if (finding.sourceLine !== undefined && finding.sourceLine.trim().length > 0) {
    out.push(`   > ${finding.sourceLine.trimEnd()}`);
  }
  if (finding.suggestion) out.push(`   Suggested fix: ${finding.suggestion}`);
  return out.join("\n");
}
