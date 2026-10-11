import type { DecisionModelStatus } from "../../common/decision-protocol.js";

/**
 * Status bar text for a decision-model download in progress or failed;
 * undefined hides the entry. A download in progress is a live state: the
 * status dock marks it with the accent dot (downloadStatusLive), so its words
 * say what is happening and it carries no glyph of its own.
 */
export function downloadStatusText(s: DecisionModelStatus): string | undefined {
  if (s.state === "downloading") {
    const pct = s.total ? Math.floor(((s.received ?? 0) / s.total) * 100) : 0;
    return `Downloading ${s.model} ${pct}%`;
  }
  if (s.state === "failed") return `$(warning) ${s.model} not downloaded`;
  return undefined;
}

/** Whether the entry shows a live state: a download in progress. */
export function downloadStatusLive(s: DecisionModelStatus): boolean {
  return s.state === "downloading";
}
