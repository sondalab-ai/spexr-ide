import type { IndexStatus } from "../../common/search-protocol.js";

/**
 * Workspace-relative paths of SPEXR's persisted artifacts. A DELETE of one of these
 * (or of the `.spexr` dir) is a genuine cache loss worth restoring; `*.tmp` churn from
 * our own atomic writes is deliberately excluded so the watcher never chases itself.
 */
const SPEXR_PERSISTED_ARTIFACTS: ReadonlySet<string> = new Set([
  ".spexr",
  ".spexr/search-index.json",
  ".spexr/descriptions.json",
]);

/**
 * True when a file-change event is a genuine loss of SPEXR's on-disk cache worth
 * restoring — a DELETE (FileChangeType 2) of the `.spexr` dir or a persisted artifact.
 * Deliberately false for `*.tmp` churn from our own atomic writes, so the watcher never
 * chases its own tail (writeFile(tmp) → rename deletes tmp → delete event → restore → …).
 */
export function isSpexrCacheLoss(path: string, changeType: number): boolean {
  return changeType === 2 && SPEXR_PERSISTED_ARTIFACTS.has(path);
}

export const CATEGORY_LABELS: Record<string, string> = {
  frontend: "Frontend",
  backend:  "Backend",
  test:     "Tests",
  config:   "Config",
  other:    "Other",
};

/** Similarity in [0,1] → rounded percentage string. */
export function formatScore(score: number): string {
  return `${Math.round(score * 100)}%`;
}

/**
 * Maps a similarity score [0,1] to a CSS color.
 * Low scores → amber, high scores → purple, gradient through yellow-green.
 */
export function scoreColor(score: number): string {
  const t = Math.max(0, Math.min(1, (score - 0.2) / 0.8));
  const hue = Math.round(30 + t * 240); // 30 (amber) → 270 (purple)
  return `hsl(${hue}, 72%, 62%)`;
}

/** Human-readable label for an index status. */
export function statusLabel(s: IndexStatus): string {
  switch (s.state) {
    case "ready":
      return "Ready";
    case "indexing":
      return `Indexing… ${s.indexed}/${s.total}`;
    case "error":
      return "Search unavailable";
    default:
      return "Idle";
  }
}

interface Debounced<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
}

/** Trailing-edge debounce with a cancel handle. */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): Debounced<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: Parameters<T>): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = (): void => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped as Debounced<T>;
}
