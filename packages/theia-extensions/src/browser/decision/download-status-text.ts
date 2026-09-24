import type { DecisionModelStatus } from "../../common/decision-protocol.js";

/** Status bar text for a decision-model download in progress or failed; undefined hides the entry. */
export function downloadStatusText(s: DecisionModelStatus): string | undefined {
  if (s.state === "downloading") {
    const pct = s.total ? Math.floor(((s.received ?? 0) / s.total) * 100) : 0;
    return `$(cloud-download) ${s.model} ${pct}%`;
  }
  if (s.state === "failed") return `$(warning) ${s.model} not downloaded`;
  return undefined;
}
