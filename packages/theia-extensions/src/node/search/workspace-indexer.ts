import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir, readdir, stat, rename } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { Embedder } from "./embedding-model.js";
import { VectorIndex } from "./vector-index.js";
import { BM25Index } from "./bm25-index.js";
import { FileClassifier } from "./file-classifier.js";
import {
  ALWAYS_SKIP_DIRS,
  DEFAULT_MAX_BYTES,
  createIgnoreFilter,
  isBinaryBuffer,
  isSkippedFile,
} from "./file-filter.js";

const MAX_CONTENT_CHARS = 2000;
const MAX_SNIPPET_CHARS = 160;
const MAX_DESC_CHARS = 120;
const INDEX_DIR = ".spexr";
const INDEX_FILE = "search-index.json";

/**
 * Split camelCase/PascalCase identifiers into lowercase words and deduplicate.
 * e.g. "AuthenticationService" → "authentication service"
 * Injected into the embedding input so semantic queries like "authentication"
 * match files that only contain identifiers like `AuthService`, `authenticate`.
 */
function extractSymbols(text: string): string {
  const words = new Set<string>();
  for (const [ident] of text.matchAll(/\b[A-Za-z][a-zA-Z0-9]{2,}\b/g)) {
    // split on camelCase/PascalCase boundaries
    for (const word of ident.split(/(?=[A-Z])/)) {
      const w = word.toLowerCase();
      if (w.length > 2) words.add(w);
    }
  }
  return [...words].slice(0, 80).join(" ");
}

/** Embedding input: path + deduplicated camelCase symbols + content prefix. */
export function buildEmbeddingInput(relPath: string, content: string): string {
  const symbols = extractSymbols(relPath + " " + content.slice(0, 3000));
  return `${relPath}\n${symbols}\n${content.slice(0, MAX_CONTENT_CHARS)}`;
}

/** Display snippet: first non-empty line, trimmed and capped. */
export function buildSnippet(content: string): string {
  const line = content.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  return line.slice(0, MAX_SNIPPET_CHARS);
}

/** Comment lines that describe tooling, not the file's purpose. */
const NOISE_RE = /copyright|license|^\(c\)|eslint|prettier|tslint|jshint|jslint|istanbul|ts-(?:ignore|nocheck|expect-error)|@ts-|use strict|@flow|@jsx|@vitest-environment|webpack|chunkname/i;

/** Strip a `/* … *\/` block to its meaningful prose lines. */
function cleanBlockComment(block: string[]): string {
  return block
    .join("\n")
    .replace(/^[ \t]*\/\*+/, "")
    .replace(/\*+\/[ \t]*$/, "")
    .split("\n")
    .map((l) => l.replace(/^[ \t]*\*\s?/, "").trim())
    .filter((l) => l && !l.startsWith("@") && !NOISE_RE.test(l) && !/^[=\-*]{3,}$/.test(l))
    .slice(0, 2)
    .join(" ")
    .trim();
}

/** Strip a contiguous `//` block to its meaningful prose lines. */
function cleanLineComment(block: string[]): string {
  return block
    .map((l) => l.replace(/^[ \t]*\/\/\s?/, "").trim())
    .filter((l) => l && !NOISE_RE.test(l) && !/^[=\-*]{3,}$/.test(l))
    .slice(0, 3)
    .join(" ")
    .trim();
}

/**
 * Extract a file-level doc comment: a comment block that precedes the first
 * code statement (only blank lines, a shebang, or skippable banners before it).
 * Comments attached to a specific declaration further down are NOT the file's
 * description, so they are deliberately ignored. Returns null if none.
 */
function extractFileHeaderDoc(content: string): string | null {
  const lines = content.split("\n");
  let i = 0;
  if (lines[0]?.startsWith("#!")) i++;
  while (i < lines.length) {
    while (i < lines.length && lines[i]!.trim() === "") i++;
    if (i >= lines.length) break;
    const line = lines[i]!.trim();

    if (line.startsWith("/*")) {
      const block: string[] = [];
      while (i < lines.length) {
        block.push(lines[i]!);
        if (lines[i]!.includes("*/")) { i++; break; }
        i++;
      }
      const text = cleanBlockComment(block);
      if (NOISE_RE.test(block.join(" "))) continue; // banner (license/tooling) → keep looking
      if (text.length > 10) return text;
      continue;
    }

    if (line.startsWith("//")) {
      const block: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith("//")) block.push(lines[i++]!);
      const text = cleanLineComment(block);
      if (NOISE_RE.test(block.join(" "))) continue;
      if (text.length > 20) return text;
      continue;
    }

    return null; // first non-comment token is real code: no file header
  }
  return null;
}

/**
 * Synthesize a whole-file description from structure when no header exists.
 * No category prefix: results are already grouped by category in the UI.
 */
function buildStructuralDescription(content: string): string {
  const classMatch = content.match(/^export (?:default )?(?:abstract )?class (\w+)/m);
  if (classMatch?.[1]) return `Defines ${classMatch[1]}.`.slice(0, MAX_DESC_CHARS);

  const exports = [
    ...new Set(
      [...content.matchAll(/^export (?:default )?(?:abstract )?(?:class|function|const|interface|type|enum) (\w+)/gm)]
        .map((m) => m[1]!)
    ),
  ].slice(0, 5);
  if (exports.length) return `Exports ${exports.join(", ")}.`.slice(0, MAX_DESC_CHARS);

  return "";
}

/**
 * Short, whole-file description. Prefers a genuine file-header comment; falls
 * back to a structural summary (class / exports).
 */
export function extractDescription(content: string): string {
  const header = extractFileHeaderDoc(content);
  if (header) return header.slice(0, MAX_DESC_CHARS);
  return buildStructuralDescription(content);
}

function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** Builds and maintains the vector index for one workspace root. */
export class WorkspaceIndexer {
  readonly index = new VectorIndex();
  bm25 = new BM25Index();
  private readonly embedder: Embedder;
  private readonly classifier: FileClassifier;

  constructor(private readonly root: string, embedder: Embedder) {
    this.embedder = embedder;
    this.classifier = new FileClassifier(embedder);
  }

  private get indexPath(): string {
    return join(this.root, INDEX_DIR, INDEX_FILE);
  }

  /** True when the persisted index file exists on disk. */
  async isPersisted(): Promise<boolean> {
    try {
      await stat(this.indexPath);
      return true;
    } catch {
      return false;
    }
  }

  /** Workspace-relative (POSIX) paths eligible for indexing. */
  async discover(): Promise<string[]> {
    let ignored: (relPath: string) => boolean = () => false;
    try {
      ignored = createIgnoreFilter(await readFile(join(this.root, ".gitignore"), "utf8"));
    } catch {
      // no .gitignore — ignore nothing
    }
    const out: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const abs = join(dir, entry.name);
        const rel = toPosix(relative(this.root, abs));
        if (entry.isDirectory()) {
          if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
          if (ignored(`${rel}/`)) continue;
          await walk(abs);
        } else if (entry.isFile()) {
          if (isSkippedFile(rel) || ignored(rel)) continue;
          const info = await stat(abs);
          if (info.size > DEFAULT_MAX_BYTES) continue;
          const buf = await readFile(abs);
          if (isBinaryBuffer(buf)) continue;
          out.push(rel);
        }
      }
    };
    await walk(this.root);
    return out;
  }

  /** Full rebuild of the index from scratch. */
  async buildAll(onProgress?: (indexed: number, total: number) => void): Promise<void> {
    const paths = await this.discover();
    let done = 0;
    for (const rel of paths) {
      await this.updateFile(rel);
      onProgress?.(++done, paths.length);
    }
  }

  /**
   * (Re)embed a single workspace-relative file, skipping unchanged content.
   * Returns true when the index was actually mutated (upsert or a real removal),
   * false when nothing changed — so callers can avoid a needless persist.
   */
  async updateFile(relPath: string): Promise<boolean> {
    // Never index our own generated dirs (esp. `.spexr/`, where saving the index would
    // change the file, invalidating its hash → re-index → re-save → infinite loop).
    // Check every path segment, not just the first — a nested node_modules
    // (e.g. packages/foo/node_modules/...) must be skipped too.
    if (relPath.split("/").some((seg) => ALWAYS_SKIP_DIRS.has(seg))) {
      return this.index.remove(relPath);
    }
    const abs = join(this.root, relPath);
    let info;
    try {
      info = await stat(abs);
    } catch {
      return this.index.remove(relPath);
    }
    if (!info.isFile() || info.size > DEFAULT_MAX_BYTES || isSkippedFile(relPath)) {
      return this.index.remove(relPath);
    }
    const buf = await readFile(abs);
    if (isBinaryBuffer(buf)) {
      return this.index.remove(relPath);
    }
    const content = buf.toString("utf8");
    const hash = createHash("sha1").update(content).digest("hex");
    if (this.index.has(relPath, hash)) return false; // unchanged content — no mutation
    const [vector] = await this.embedder.embed([buildEmbeddingInput(relPath, content)]);
    const category = await this.classifier.classify(relPath, content.slice(0, 500), vector!);
    this.index.upsert({
      path: relPath,
      vector: vector!,
      mtimeMs: info.mtimeMs,
      hash,
      snippet: buildSnippet(content),
      category,
      description: extractDescription(content),
    });
    this.bm25.upsert(relPath, relPath + " " + content.slice(0, 5000));
    return true;
  }

  /** Remove a file from the index; returns true when a record was actually present. */
  removeFile(relPath: string): boolean {
    const existed = this.index.remove(relPath);
    this.bm25.remove(relPath);
    return existed;
  }

  /** Load a persisted index; returns false if absent or unreadable. */
  async load(): Promise<boolean> {
    try {
      const raw = await readFile(this.indexPath, "utf8");
      const parsed = JSON.parse(raw);
      const restored = VectorIndex.fromJSON(parsed);
      // An empty persisted index is treated as "nothing worth loading" — return false intentionally.
      if (restored.size === 0) return false;
      this.index.replaceWith(restored);
      if (parsed.bm25) this.bm25 = BM25Index.fromJSON(parsed.bm25);
      return true;
    } catch {
      return false;
    }
  }

  async save(): Promise<void> {
    await mkdir(join(this.root, INDEX_DIR), { recursive: true });
    const data = { ...this.index.toJSON(), bm25: this.bm25.toJSON() };
    const tmp = `${this.indexPath}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, this.indexPath);
  }
}
