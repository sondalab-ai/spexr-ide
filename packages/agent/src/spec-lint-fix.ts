import type { SpecLintFinding, SpecLintSeverity } from "@spexr/spec";

/** Severity words the agent reads, spelled out rather than abbreviated. */
const SEVERITY_LABEL: Record<SpecLintSeverity, string> = {
  error: "error",
  warn: "warning",
  info: "info",
};

export interface SpecLintFixInput {
  /** Spec slug, e.g. `0014-git-hardening`. */
  readonly slug: string;
  /** Raw markdown of the spec as saved on disk. */
  readonly specBody: string;
  /** Findings the validator is currently reporting for that spec. */
  readonly findings: readonly SpecLintFinding[];
}

/**
 * Assemble the agent message that asks for a spec's validation findings to be
 * fixed.
 *
 * Findings carry their line anchors so the agent can go straight to them, and
 * the rules fence the task to the spec file: a validator finding is a defect in
 * the document, never a reason to touch code, drop a criterion, or rewrite
 * parts the validator did not flag.
 */
export function buildSpecLintFixPrompt(input: SpecLintFixInput): string {
  const { slug, specBody, findings } = input;
  return [
    `Fix the spec validation findings on \`${slug}.md\`.`,
    "",
    "Rules:",
    "- Edit only that spec file. These are defects in the document — do not change code or tests.",
    "- Preserve the meaning of every acceptance criterion: renumber, relabel or reword it, never drop or invent one.",
    "- When an id changes, update every reference to it in the same file.",
    "- Leave anything the validator did not report untouched.",
    "",
    `Findings (${findings.length}):`,
    ...findings.map(formatFinding),
    "",
    "---",
    "",
    specBody,
  ].join("\n");
}

function formatFinding(finding: SpecLintFinding): string {
  const where = finding.line === undefined ? finding.section : `${finding.section} L${finding.line}`;
  const suggestion = finding.suggestion ? ` Suggested fix: ${finding.suggestion}` : "";
  return `- [${SEVERITY_LABEL[finding.severity]}] ${where}: ${finding.message}${suggestion}`;
}
