import { resolve, join } from "node:path";
import { existsSync } from "node:fs";

/**
 * Root of the theia-extensions package at runtime.
 *
 * Two strategies because __dirname differs between dev and webpack:
 * - Source tree: lib/node/search/*.js → ../../.. is the package root.
 * - Webpack bundle (apps/desktop/lib/backend/main.js): ../../.. is not the
 *   package, so fall back to node_modules/@spexr/theia-extensions (a workspace
 *   symlink reachable from the bundle).
 */
function resolvePackageDir(): string {
  const fromSource = resolve(__dirname, "..", "..", "..");
  if (existsSync(join(fromSource, "resources", "models"))) return fromSource;
  return resolve(__dirname, "..", "..", "node_modules", "@spexr", "theia-extensions");
}

/** Directory holding vendored ONNX models: env override, else <package>/resources/models. */
export function resolveModelsDir(): string {
  if (process.env.SPEXR_MODELS_DIR) return process.env.SPEXR_MODELS_DIR;
  return join(resolvePackageDir(), "resources", "models");
}

/** Absolute path to the compiled description worker entry. */
export function resolveWorkerPath(): string {
  return join(resolvePackageDir(), "lib", "node", "search", "description-worker.js");
}

/** Absolute path to the compiled decision worker entry (spec 0017). */
export function resolveDecisionWorkerPath(): string {
  return join(resolvePackageDir(), "lib", "node", "decision", "decision-worker.js");
}
