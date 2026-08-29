import type { GitFileState } from "../common/git-protocol.js";
import { extractSymbolNames, PROSE_LIKE_EXTS } from "./search/description-format.js";

/** One staged path with the index letter git reported for it. */
export interface StagedFile {
  readonly path: string;
  readonly state: GitFileState;
}

/** How many paths the prompt lists before it stops and counts the rest. */
const MAX_PROMPT_FILES = 12;

/** Caps on the distilled change itself, so one huge commit cannot flood the prompt. */
const MAX_ADDED_SYMBOLS = 8;
const MAX_REMOVED_SYMBOLS = 4;
const MAX_PROSE_LINES = 8;
const PROSE_LINE_CHARS = 90;

/**
 * Folders that group code without describing it. Build containers ("src") and the
 * layer folders this codebase splits every extension into ("browser", "node",
 * "common") both name where code lives, never what it is about.
 */
const CONTAINER_DIRS = new Set([
  "packages", "apps", "src", "lib", "dist",
  "browser", "node", "common",
]);

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

/** The deepest folder of `path` that names something, or "" when it has none. */
function meaningfulDir(path: string): string {
  const named = dirSegments(path).filter((s) => !CONTAINER_DIRS.has(s));
  return named[named.length - 1] ?? "";
}

/**
 * The folder most of the change lives in, when there is one. Preferred over the
 * shared parent: a change that is four files in `darkfactory` and one stylesheet
 * next door is about darkfactory, while their shared parent is only a layer.
 */
function modalDir(files: readonly StagedFile[]): string {
  const counts = new Map<string, number>();
  for (const file of files) {
    const dir = meaningfulDir(file.path);
    if (dir) counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [dir, count] of counts) {
    if (count > bestCount) {
      best = dir;
      bestCount = count;
    }
  }
  // A plurality that is not a strict majority means the change is spread out: the
  // shared parent describes it better than the largest of several minorities, and
  // a tie would otherwise be broken by nothing more than file order.
  return bestCount * 2 > files.length ? best : "";
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
  const shared = commonDir(files).filter((s) => !CONTAINER_DIRS.has(s));
  const scope = modalDir(files) || shared[shared.length - 1];
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

/** The added and removed line text of one file, as parsed out of a unified diff. */
export interface DiffSides {
  readonly path: string;
  readonly added: string;
  readonly removed: string;
}

/** Drop git's `a/`/`b/` prefix from a diff header path. */
function headerPath(raw: string): string {
  const path = raw.trim();
  return path === "/dev/null" ? path : path.replace(/^[ab]\//, "");
}

/**
 * Parse `git diff -U0` into the added and removed text of each file. Line
 * indentation is preserved: {@link extractSymbolNames} anchors its patterns on it.
 */
export function splitDiffByFile(diff: string): DiffSides[] {
  const out: DiffSides[] = [];
  let pre = "";
  let post = "";
  let added: string[] = [];
  let removed: string[] = [];
  let open = false;
  const flush = (): void => {
    if (!open) return;
    // A deletion has no post-image, so the file is named by the side that exists.
    const path = post && post !== "/dev/null" ? post : pre;
    if (path && path !== "/dev/null") out.push({ path, added: added.join("\n"), removed: removed.join("\n") });
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      pre = post = "";
      added = [];
      removed = [];
      open = true;
      continue;
    }
    if (!open) continue;
    if (line.startsWith("--- ")) pre = headerPath(line.slice(4));
    else if (line.startsWith("+++ ")) post = headerPath(line.slice(4));
    else if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  flush();
  return out;
}

function isProsePath(path: string): boolean {
  return PROSE_LIKE_EXTS.has(path.split(".").pop()?.toLowerCase() ?? "");
}

function pushNew(into: string[], names: readonly string[]): void {
  for (const name of names) if (!into.includes(name)) into.push(name);
}

/**
 * User message for the commit subject: the staged paths, the declarations the
 * change introduces or drops, and the text a prose file gained.
 *
 * Not the diff itself. Handed only paths the model can do no better than
 * paraphrase them ("fix index.js and specs"); handed diff hunks it drowns in
 * noise against a ~30 token budget. Declaration names are the same distillation
 * {@link buildSymbolSummary} already uses for file descriptions, and they are what
 * makes the reply name a real thing.
 */
export function buildCommitPrompt(files: readonly StagedFile[], diff: string): string {
  const sides = new Map(splitDiffByFile(diff).map((s) => [s.path, s]));
  // Test declarations scaffold a change rather than being it, so they are read
  // only when skipping them would leave nothing to say.
  const production = files.filter((f) => !isTestPath(f.path));
  const named = collectNames(production, sides);
  const { introduced, dropped } = named.introduced.length + named.dropped.length > 0
    ? named
    : collectNames(files, sides);

  const prose = sampleProse(files, sides);

  const rest = files.length - MAX_PROMPT_FILES;
  const parts = [
    "Staged changes (git status letter, then path):",
    ...files.slice(0, MAX_PROMPT_FILES).map((f) => `${f.state} ${f.path}`),
  ];
  if (rest > 0) parts.push(`… and ${rest} more files`);
  // Phrased as a sentence about the change, not as a labelled list: given a
  // heading like "Declarations added:" the model answers by reading the list back
  // ("add declarations for agent group header, tile group, …") instead of saying
  // what the change is.
  if (introduced.length > 0) {
    parts.push(`\nThe change introduces: ${introduced.slice(0, MAX_ADDED_SYMBOLS).join(", ")}`);
  }
  if (dropped.length > 0) parts.push(`The change drops: ${dropped.slice(0, MAX_REMOVED_SYMBOLS).join(", ")}`);
  // Prose is the fallback, not a supplement: given both, the model answers about
  // the stylesheet comment it just read instead of the change it was shown.
  if (introduced.length + dropped.length === 0 && prose.length > 0) {
    parts.push(`\nText added:\n${prose.slice(0, MAX_PROSE_LINES).map((l) => `- ${l}`).join("\n")}`);
  }
  parts.push("\nWrite the one-line summary.");
  return parts.join("\n");
}

/** Shortest line worth showing; below this it is a fence, a bracket or a bullet. */
const MIN_PROSE_CHARS = 4;

/**
 * The added prose of the changeset, one line per file per round. Sampling in file
 * order instead lets one chatty file fill the whole budget — four specs sharing a
 * frontmatter block yielded nothing but three repeated keys, and the paragraphs
 * that said what the change was never reached the model. Duplicates are dropped
 * for the same reason.
 */
function sampleProse(files: readonly StagedFile[], sides: ReadonlyMap<string, DiffSides>): string[] {
  const perFile = files
    .filter((f) => isProsePath(f.path) && sides.has(f.path))
    .map((f) =>
      sides
        .get(f.path)!
        .added.split("\n")
        .map((l) => l.trim().slice(0, PROSE_LINE_CHARS))
        .filter((l) => l.length >= MIN_PROSE_CHARS),
    );
  const out: string[] = [];
  const seen = new Set<string>();
  const deepest = Math.max(0, ...perFile.map((lines) => lines.length));
  for (let round = 0; round < deepest && out.length < MAX_PROSE_LINES; round++) {
    for (const lines of perFile) {
      const line = lines[round];
      if (line === undefined || seen.has(line)) continue;
      seen.add(line);
      out.push(line);
      if (out.length >= MAX_PROSE_LINES) break;
    }
  }
  return out;
}

/** Declaration names a set of files introduces and drops, ignoring in-place edits. */
function collectNames(
  files: readonly StagedFile[],
  sides: ReadonlyMap<string, DiffSides>,
): { introduced: string[]; dropped: string[] } {
  const added: string[] = [];
  const removed: string[] = [];
  for (const file of files) {
    const side = sides.get(file.path);
    if (!side || isProsePath(file.path)) continue;
    pushNew(added, extractSymbolNames(side.added));
    pushNew(removed, extractSymbolNames(side.removed));
  }
  // A name on both sides was edited in place, not introduced or dropped; listing
  // it under either heading would say something untrue about the change.
  return {
    introduced: added.filter((n) => !removed.includes(n)),
    dropped: removed.filter((n) => !added.includes(n)),
  };
}
