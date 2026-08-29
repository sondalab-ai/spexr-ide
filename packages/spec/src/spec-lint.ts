import { parseFrontmatter } from "./frontmatter.js";
import { hasAuthoredAcceptanceCriteria } from "./workflow.js";
import type {
  AcceptanceCriterion,
  SpecLintFinding,
  SpecLintReport,
  SpecLintSection,
  SpecStatus,
} from "./types.js";

export interface SpecLintOptions {
  /** Spec filename (with extension) — used for slug/stem coherence. */
  readonly filename: string;
  /**
   * Slugs of existing specs, to validate `relatedSpecs` against. When omitted
   * the `relatedSpecs` check is skipped (caller doesn't know the universe).
   */
  readonly knownSlugs?: readonly string[];
}

const VALID_STATUSES: ReadonlySet<SpecStatus> = new Set<SpecStatus>([
  "draft",
  "ready",
  "in-progress",
  "implemented",
  "validated",
  "shipped",
  "archived",
]);

/** Scaffold strings emitted by the spec template that must be replaced. */
const SCAFFOLD_SNIPPETS = ["Describe the user-facing outcome"];

/** Markers a draft leaves behind where content is still owed. */
const PLACEHOLDER_MARKER_RE = /\b(?:TBD|TODO)\b/g;

const HEADING_RE = /^##\s+(.+?)\s*$/;
/** Any markdown heading — ends the acceptance bullet being accumulated. */
const ANY_HEADING_RE = /^#{1,6}\s/;
const BULLET_RE = /^\s*[-*]\s+(\S.*?)\s*$/;
const EMPTY_BULLET_RE = /^\s*[-*]\s*$/;
/**
 * Leading `**AC-1**` or `**AC-1 Short title.**` label of an acceptance bullet.
 * Anchored, so a cross-reference to another criterion inside the prose is not
 * mistaken for this bullet's own id.
 */
const AC_ID_RE = /^\*\*([A-Za-z]+-\d+)\b\s*([^*]*?)\*\*\s*/;

/**
 * An acceptance criterion bullet. Top-level only: an indented bullet is a
 * detail of the criterion above it, not a criterion of its own.
 */
const AC_BULLET_RE = /^[-*]\s+(\S.*?)\s*$/;
const ID_PARTS_RE = /^([A-Za-z]+)-(\d+)$/;

/**
 * Words that signal a verifiable predicate in an acceptance criterion. An AC
 * that is short *and* matches none of these reads as a vague aspiration rather
 * than a testable statement (AC-4 `info`).
 */
const VERIFIABLE_SIGNAL_RE =
  /\b(returns?|shows?|displays?|renders?|writes?|reads?|sets?|clears?|deletes?|removes?|creates?|adds?|opens?|closes?|reveals?|navigates?|refreshes?|tracks?|flags?|produces?|emits?|fires?|throws?|equals?|matches?|contains?|includes?|appears?|persists?|highlight\w*|recogni\w+|is|are|must|should|when|then|never|exactly|each|count\w*)\b|→/i;

/** Map an H2 heading to a canonical section label, or undefined if not ours. */
function sectionFromHeading(heading: string): SpecLintSection | undefined {
  const h = heading.toLowerCase();
  if (h === "goal") return "Goal";
  if (h === "non-goals" || h === "non goals") return "Non-goals";
  if (h === "acceptance criteria" || h === "acceptance-criteria") return "Acceptance Criteria";
  if (h === "notes") return "Notes";
  return undefined;
}

interface AcBullet {
  readonly line: number;
  readonly id?: string;
  readonly text: string;
}

/**
 * Validate a spec's markdown against the SPEXR spec contract. Pure and
 * line-aware: findings carry a 1-based line for editor navigation. Tolerates
 * parse failure — invalid frontmatter yields a finding, never a throw (AC-1).
 */
export function lintSpec(raw: string, options: SpecLintOptions): SpecLintReport {
  let findings: SpecLintFinding[];
  try {
    findings = collectFindings(raw, options);
  } catch (err) {
    findings = [
      {
        severity: "error",
        section: "Document",
        message: `Spec could not be validated: ${err instanceof Error ? err.message : String(err)}`,
      },
    ];
  }
  return {
    findings,
    errorCount: findings.filter((f) => f.severity === "error").length,
    warnCount: findings.filter((f) => f.severity === "warn").length,
    infoCount: findings.filter((f) => f.severity === "info").length,
  };
}

function collectFindings(raw: string, options: SpecLintOptions): SpecLintFinding[] {
  const lines = raw.split(/\r?\n/);
  const sectionOf = computeSectionOf(lines);
  const findings: SpecLintFinding[] = [];

  lintFrontmatter(raw, lines, options, findings);
  lintPlaceholders(lines, sectionOf, findings);
  lintSections(lines, sectionOf, findings);

  return findings;
}

/** Per-line section label, so any line can be anchored to its section. */
function computeSectionOf(lines: readonly string[]): SpecLintSection[] {
  const frontmatterEnd = frontmatterEndIndex(lines);
  const out: SpecLintSection[] = [];
  let current: SpecLintSection = "Document";
  for (let i = 0; i < lines.length; i++) {
    if (frontmatterEnd >= 0 && i <= frontmatterEnd) {
      out.push("Frontmatter");
      continue;
    }
    const m = HEADING_RE.exec(lines[i]!);
    if (m) current = sectionFromHeading(m[1]!) ?? "Document";
    out.push(current);
  }
  return out;
}

/** Index of the closing `---` of a leading frontmatter block, or -1. */
function frontmatterEndIndex(lines: readonly string[]): number {
  if (lines[0]?.trim() !== "---") return -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") return i;
  }
  return -1;
}

function lintFrontmatter(
  raw: string,
  lines: readonly string[],
  options: SpecLintOptions,
  out: SpecLintFinding[],
): void {
  if (frontmatterEndIndex(lines) < 0) {
    out.push({
      severity: "error",
      section: "Frontmatter",
      message: "Missing or malformed frontmatter block.",
      suggestion: "Open the file with a `---` frontmatter block declaring slug, title, status.",
      line: 1,
    });
    return;
  }
  const { data } = parseFrontmatter(raw);

  const title = typeof data.title === "string" ? data.title.trim() : "";
  if (title.length === 0) {
    out.push({
      severity: "error",
      section: "Frontmatter",
      message: "Frontmatter `title` is empty.",
      ...lineForKey(lines, "title"),
    });
  }

  const status = typeof data.status === "string" ? data.status : "";
  if (!VALID_STATUSES.has(status as SpecStatus)) {
    out.push({
      severity: "error",
      section: "Frontmatter",
      message: `Invalid status "${status}".`,
      suggestion: "Use one of: draft, ready, in-progress, implemented, validated, shipped, archived.",
      ...lineForKey(lines, "status"),
    });
  }

  const slug = typeof data.slug === "string" ? data.slug : "";
  const stem = stemOf(options.filename);
  if (slug !== stem) {
    out.push({
      severity: "error",
      section: "Frontmatter",
      message: `slug "${slug}" does not match filename stem "${stem}".`,
      ...lineForKey(lines, "slug"),
    });
  }

  if (options.knownSlugs && Array.isArray(data.relatedSpecs)) {
    const known = new Set(options.knownSlugs);
    for (const entry of data.relatedSpecs) {
      if (typeof entry === "string" && !known.has(entry)) {
        out.push({
          severity: "warn",
          section: "Frontmatter",
          message: `relatedSpecs entry "${entry}" matches no existing spec.`,
          ...lineForKey(lines, "relatedSpecs"),
        });
      }
    }
  }
}

function lintPlaceholders(
  lines: readonly string[],
  sectionOf: readonly SpecLintSection[],
  out: SpecLintFinding[],
): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const section = sectionOf[i]!;
    if (section === "Frontmatter") continue;
    const at = { section, line: i + 1 };

    if (SCAFFOLD_SNIPPETS.some((s) => hasUncited(line, s))) {
      out.push({ severity: "warn", message: "Unsubstituted scaffold text.", ...at });
      continue;
    }
    if (hasUncitedMatch(line, PLACEHOLDER_MARKER_RE)) {
      out.push({ severity: "warn", message: "Placeholder marker (TBD/TODO).", ...at });
      continue;
    }
    if (EMPTY_BULLET_RE.test(line)) {
      out.push({ severity: "warn", message: "Empty bullet.", ...at });
      continue;
    }
    if (line.includes("<!--")) {
      out.push({ severity: "warn", message: "Leftover scaffold comment.", ...at });
    }
  }
}

function lintSections(
  lines: readonly string[],
  sectionOf: readonly SpecLintSection[],
  out: SpecLintFinding[],
): void {
  // Goal — empty section body.
  const goalLine = headingLine(lines, "Goal");
  if (goalLine >= 0 && sectionBodyEmpty(lines, sectionOf, "Goal")) {
    out.push({
      severity: "warn",
      section: "Goal",
      message: "Goal section is empty.",
      suggestion: "Describe the user-facing outcome this spec delivers.",
      line: goalLine + 1,
    });
  }

  // Non-goals — no authored bullet.
  const nonGoalsLine = headingLine(lines, "Non-goals");
  if (nonGoalsLine >= 0 && !hasAuthoredBullet(lines, sectionOf, "Non-goals")) {
    out.push({
      severity: "warn",
      section: "Non-goals",
      message: "Non-goals section has no entries.",
      line: nonGoalsLine + 1,
    });
  }

  // Acceptance Criteria — parse bullets, validate ids, then check emptiness.
  const acLine = headingLine(lines, "Acceptance Criteria");
  const bullets = collectAcBullets(lines, sectionOf);
  const criteria: AcceptanceCriterion[] = bullets.map((b, i) => ({
    id: b.id ?? `AC-${i + 1}`,
    text: b.text,
  }));
  if (!hasAuthoredAcceptanceCriteria(criteria)) {
    out.push({
      severity: "warn",
      section: "Acceptance Criteria",
      message: "No authored acceptance criteria.",
      suggestion: "Add `- **AC-1** The system …` bullets.",
      ...(acLine >= 0 ? { line: acLine + 1 } : {}),
    });
  }
  lintAcBullets(bullets, out);
}

function lintAcBullets(bullets: readonly AcBullet[], out: SpecLintFinding[]): void {
  const seen = new Map<string, number>();
  const seqByPrefix = new Map<string, number>();

  for (const b of bullets) {
    if (!b.id) {
      out.push({
        severity: "warn",
        section: "Acceptance Criteria",
        message: "Acceptance criterion has no **AC-N** id.",
        line: b.line,
      });
      continue;
    }

    const firstAt = seen.get(b.id);
    if (firstAt !== undefined) {
      out.push({
        severity: "error",
        section: "Acceptance Criteria",
        message: `Duplicate id ${b.id} (first seen at L${firstAt}).`,
        line: b.line,
      });
    } else {
      seen.set(b.id, b.line);
    }

    const parts = ID_PARTS_RE.exec(b.id);
    if (parts) {
      const prefix = parts[1]!;
      const num = Number(parts[2]);
      const expected = (seqByPrefix.get(prefix) ?? 0) + 1;
      // Resync on the observed number, so one misplaced id reports once
      // instead of shifting every id after it.
      seqByPrefix.set(prefix, num);
      if (num !== expected && firstAt === undefined) {
        out.push({
          severity: "warn",
          section: "Acceptance Criteria",
          message: `Non-sequential id ${b.id} (expected ${prefix}-${expected}).`,
          line: b.line,
        });
      }
    }

    if (isVague(b.text)) {
      out.push({
        severity: "info",
        section: "Acceptance Criteria",
        message: `${b.id} has no verifiable predicate.`,
        suggestion: "State a concrete, observable behaviour.",
        line: b.line,
      });
    }
  }
}

/**
 * Acceptance bullets with their wrapped continuation lines folded in. A
 * criterion is authored as a paragraph, so judging it by its first physical
 * line alone would read a precise statement as a one-liner.
 */
function collectAcBullets(
  lines: readonly string[],
  sectionOf: readonly SpecLintSection[],
): AcBullet[] {
  const out: { line: number; id?: string; parts: string[] }[] = [];
  let current: (typeof out)[number] | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (sectionOf[i] !== "Acceptance Criteria" || ANY_HEADING_RE.test(line)) {
      current = undefined;
      continue;
    }
    const m = AC_BULLET_RE.exec(line);
    if (m) {
      const content = m[1]!;
      const idMatch = AC_ID_RE.exec(content);
      const body = (idMatch ? content.slice(idMatch[0].length) : content)
        .replace(/^\s*[:.-]\s*/, "")
        .trim();
      current = {
        line: i + 1,
        ...(idMatch?.[1] ? { id: idMatch[1] } : {}),
        parts: [idMatch?.[2]?.trim() ?? "", body],
      };
      out.push(current);
      continue;
    }
    if (current && line.trim().length > 0) current.parts.push(line.trim());
  }

  return out.map((b) => ({
    line: b.line,
    ...(b.id ? { id: b.id } : {}),
    text: b.parts.filter((part) => part.length > 0).join(" "),
  }));
}

/**
 * Whether the text at `at` sits inside a code span or quotation marks. A spec
 * that documents the template quotes its strings, and a citation is not
 * leftover scaffolding.
 */
function isCited(line: string, at: number): boolean {
  const before = line.slice(0, at);
  return count(before, "`") % 2 === 1 || count(before, '"') % 2 === 1;
}

/** Whether `snippet` occurs on the line outside any citation. */
function hasUncited(line: string, snippet: string): boolean {
  for (let at = line.indexOf(snippet); at >= 0; at = line.indexOf(snippet, at + 1)) {
    if (!isCited(line, at)) return true;
  }
  return false;
}

/** Whether `re` (global) matches the line outside any citation. */
function hasUncitedMatch(line: string, re: RegExp): boolean {
  re.lastIndex = 0;
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    if (!isCited(line, m.index)) return true;
  }
  return false;
}

function count(text: string, char: string): number {
  let n = 0;
  for (const c of text) if (c === char) n++;
  return n;
}

/** An AC is vague when it is short and carries no verifiable-predicate signal. */
function isVague(text: string): boolean {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0 || words.length > 5) return false;
  return !VERIFIABLE_SIGNAL_RE.test(text);
}

function headingLine(lines: readonly string[], section: SpecLintSection): number {
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]!);
    if (m && sectionFromHeading(m[1]!) === section) return i;
  }
  return -1;
}

function sectionBodyEmpty(
  lines: readonly string[],
  sectionOf: readonly SpecLintSection[],
  section: SpecLintSection,
): boolean {
  for (let i = 0; i < lines.length; i++) {
    if (sectionOf[i] !== section) continue;
    if (HEADING_RE.test(lines[i]!)) continue;
    if (lines[i]!.trim().length > 0) return false;
  }
  return true;
}

function hasAuthoredBullet(
  lines: readonly string[],
  sectionOf: readonly SpecLintSection[],
  section: SpecLintSection,
): boolean {
  for (let i = 0; i < lines.length; i++) {
    if (sectionOf[i] !== section) continue;
    if (BULLET_RE.test(lines[i]!)) return true;
  }
  return false;
}

/** `{ line }` for the frontmatter key, or empty when the key is absent. */
function lineForKey(lines: readonly string[], key: string): { line?: number } {
  const re = new RegExp(`^${key}:\\s*`);
  const end = frontmatterEndIndex(lines);
  const limit = end < 0 ? lines.length : end;
  for (let i = 0; i < limit; i++) {
    if (re.test(lines[i]!)) return { line: i + 1 };
  }
  return {};
}

function stemOf(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  return base.replace(/\.md$/, "");
}
