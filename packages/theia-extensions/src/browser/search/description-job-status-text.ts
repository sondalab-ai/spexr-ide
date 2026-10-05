import type { DescriptionJobStatus } from "../../common/search-protocol.js";

/**
 * The status bar's words for the codebase-understanding job, and whether the
 * job is live. A running job is a live state: the status dock marks it with
 * the accent dot (STATUS_LIVE), so it carries no glyph of its own. A paused or
 * failed job keeps its glyph. Undefined hides the entry.
 */
export function descriptionJobStatusText(s: DescriptionJobStatus): { text: string; live: boolean } | undefined {
  if (s.state === "idle" || s.state === "complete") return undefined;
  if (s.state === "running") return { text: `Understanding ${s.done}/${s.total}`, live: true };
  if (s.state === "paused") return { text: `$(debug-pause) Understanding paused ${s.done}/${s.total}`, live: false };
  return { text: "$(error) Understanding failed", live: false };
}
