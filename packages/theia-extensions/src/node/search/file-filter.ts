import ignore from "ignore";

/** Directories never walked during indexing: VCS, build output, dependency/vendor trees, caches. */
export const ALWAYS_SKIP_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  ".spexr",
  "dist",
  "lib",
  "build",
  "out",
  ".turbo",
  // Dependency / vendor trees.
  "vendor",
  "bower_components",
  "Pods",
  ".venv",
  "venv",
  "__pycache__",
  // Framework build / cache output.
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".astro",
  ".gradle",
  ".cache",
  "coverage",
]);

export const DEFAULT_MAX_BYTES = 1_000_000;

const SKIPPED_EXTENSIONS: ReadonlySet<string> = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg",
  "woff", "woff2", "ttf", "otf", "eot",
  "pdf", "zip", "gz", "tar", "rar", "7z",
  "mp3", "mp4", "mov", "avi", "wav", "ogg", "webm",
  "exe", "dll", "dylib", "so", "node", "wasm", "onnx", "bin",
  "class", "jar", "lock", "map",
  "gitignore",
  // Generated / derived text artifacts: real text, but noise in a semantic search —
  // patch dumps, test snapshots, build caches, and log output.
  "diff", "patch", "snap", "tsbuildinfo", "log",
]);

/**
 * Lockfiles identified by their full name, not their extension. The `*.lock` family
 * (yarn.lock, cargo.lock, composer.lock, poetry.lock, Gemfile.lock…) is already caught
 * by the "lock" extension; these are the ones whose extension is json/yaml/sum/lockb.
 */
const SKIPPED_BASENAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "bun.lockb",
  "go.sum",
]);

/** The last path segment (handles both "/"-separated relative paths and bare names). */
function basename(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  return slash < 0 ? filePath : filePath.slice(slash + 1);
}

/** True when the file's extension is a known non-text/binary type. */
export function isSkippedExtension(filePath: string): boolean {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return false;
  return SKIPPED_EXTENSIONS.has(filePath.slice(dot + 1).toLowerCase());
}

/**
 * True when a file should be excluded from indexing: a binary/non-text extension,
 * a minified bundle (`*.min.js`, `*.min.css` — generated, unreadable), or a lockfile
 * whose name rather than extension identifies it.
 */
export function isSkippedFile(filePath: string): boolean {
  if (isSkippedExtension(filePath)) return true;
  const name = basename(filePath).toLowerCase();
  return name.includes(".min.") || SKIPPED_BASENAMES.has(name);
}

/** True when the first 8000 bytes contain a NUL byte (heuristic for binary). */
export function isBinaryBuffer(buf: Buffer): boolean {
  const end = Math.min(buf.length, 8000);
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

/**
 * Build a predicate that reports whether a workspace-relative path is excluded
 * by the given `.gitignore` contents. Empty input ignores nothing.
 */
export function createIgnoreFilter(gitignoreText: string): (relPath: string) => boolean {
  const matcher = ignore().add(gitignoreText);
  return (relPath: string) => relPath.length > 0 && matcher.ignores(relPath);
}
