import type { GitFileState } from "../common/git-protocol.js";

/** One staged path with the index letter git reported for it. */
export interface StagedFile {
  readonly path: string;
  readonly state: GitFileState;
}

/** How many paths the prompt lists before it stops and counts the rest. */
const MAX_PROMPT_FILES = 20;

/**
 * Folders that group code without describing it — a scope of "src" or "packages"
 * tells a reader nothing, so they are skipped when picking one.
 */
const CONTAINER_DIRS = new Set(["packages", "apps", "src", "lib", "dist"]);

function segments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

/** Path segments of the folder holding `path`. */
function dirSegments(path: string): string[] {
  return segments(path).slice(0, -1);
}

function isTestPath(path: string): boolean {
  if (/\.(test|spec)\.[^/]+$/.test(path)) return true;
  return segments(path).some((s) => s === "test" || s === "tests" || s === "__tests__");
}

function isDocPath(path: string): boolean {
  return path.endsWith(".md") || segments(path)[0] === "docs";
}

/** Longest folder path every staged file shares. */
function commonDir(files: readonly StagedFile[]): string[] {
  const first = files[0];
  if (!first) return [];
  let shared = dirSegments(first.path);
  for (const file of files.slice(1)) {
    const other = dirSegments(file.path);
    let i = 0;
    while (i < shared.length && i < other.length && shared[i] === other[i]) i++;
    shared = shared.slice(0, i);
  }
  return shared;
}

/**
 * The Conventional Commits prefix, derived from the paths alone — deterministic
 * on purpose. The local model writes the clause after the colon; picking the type
 * and scope is structure, which it is not reliable at.
 *
 * Type: tests and documentation win over everything (a change that is entirely
 * either one is that kind of change), then a newly added file makes it a feature,
 * and anything else is a fix. A new *test* file does not: every bug fix here ships
 * with a regression test, and that must not turn each of them into a feature.
 * Scope: the deepest shared folder that names something, or none when the change
 * spans unrelated trees.
 */
export function commitPrefix(files: readonly StagedFile[]): string {
  if (files.length === 0) return "";
  const type = files.every((f) => isTestPath(f.path))
    ? "test"
    : files.every((f) => isDocPath(f.path))
      ? "docs"
      : files.some((f) => f.state === "A" && !isTestPath(f.path))
        ? "feat"
        : "fix";
  const named = commonDir(files).filter((s) => !CONTAINER_DIRS.has(s));
  const scope = named[named.length - 1];
  return scope ? `${type}(${scope})` : type;
}

/**
 * Turn one model reply into a commit subject: the first real line, stripped of
 * markdown, labels, quotes, a prefix the model wrote on its own (the caller
 * composes that), and a trailing period, then lowercased to follow the colon.
 *
 * Deliberately not {@link cleanSummaryLine}: that one forces the third person and
 * strips a leading "The"/"This", which are rules for a session summary and mangle
 * a subject.
 */
export function cleanCommitSubject(raw: string): string {
  const first =
    raw
      .split("\n")
      .map((line) =>
        line
          .replace(/\*+/g, "")
          .replace(/^#+\s*/, "")
          .replace(/^[-•]\s*/, "")
          .replace(/^(?:commit\s+message|subject|message|title)\s*[:\-]\s*/i, "")
          .trim(),
      )
      .find((line) => line.length > 0) ?? "";
  const cleaned = first
    .replace(/^["'`\s]+|["'`\s.]+$/g, "")
    .replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "")
    .trim();
  if (cleaned.length === 0) return "";
  // An acronym keeps its case; an ordinary opening word does not, since the
  // subject reads as the continuation of "type(scope): ".
  const opening = cleaned.split(/\s/)[0] ?? "";
  if (/^[A-Z]{2,}/.test(opening)) return cleaned;
  return cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
}

/**
 * User message for the commit subject. Lists the staged paths and their status
 * letters rather than the diff: this model invents specifics when handed noisy
 * input, and a diff against a ~50 token budget is the noisiest input there is.
 */
export function buildCommitPrompt(files: readonly StagedFile[]): string {
  const shown = files
    .slice(0, MAX_PROMPT_FILES)
    .map((f) => `${f.state} ${f.path}`)
    .join("\n");
  const rest = files.length - MAX_PROMPT_FILES;
  const more = rest > 0 ? `\n… and ${rest} more files` : "";
  return `Staged changes (git status letter, then path):\n${shown}${more}\n\nWrite the one-line summary.`;
}
