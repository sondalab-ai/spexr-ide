import type { AgentTile, AgentState } from "../../common/darkfactory-protocol.js";

/** Coarse "time ago" bucket for a past epoch-ms timestamp. */
export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Human label for a session state. */
export function stateLabel(state: AgentState): string {
  return state === "working" ? "Working" : state === "idle" ? "Idle" : "Done";
}

const STATE_RANK: Record<AgentState, number> = { working: 0, idle: 1, done: 2 };

/** Lower = higher attention. Needs-you always outranks state. */
export function attentionRank(state: AgentState, needsYou: boolean): number {
  return (needsYou ? 0 : 1) * 10 + STATE_RANK[state];
}

/** Needs-you → working → idle → done, then most-recently-active first. */
export function sortTiles(tiles: AgentTile[]): AgentTile[] {
  return [...tiles].sort(
    (a, b) =>
      attentionRank(a.state, a.needsYou) - attentionRank(b.state, b.needsYou) ||
      b.lastActivityMs - a.lastActivityMs,
  );
}

/** Human label for a permission mode; never a bare token. */
export function permissionLabel(mode: string | undefined): string {
  switch (mode) {
    case "auto":
      return "Auto-approve tools";
    case "plan":
      return "Plan mode";
    case "default":
      return "Ask each time";
    default:
      return mode ? mode : "Ask each time";
  }
}

/** Human label for a non-default `mode`; undefined for the default so it stays hidden. */
export function modeLabel(mode: string | undefined): string | undefined {
  if (!mode || mode === "normal") return undefined;
  return mode.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
