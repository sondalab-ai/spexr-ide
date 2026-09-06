import type { AgentSummary, AgentTile } from "../../common/darkfactory-protocol.js";

/**
 * Floor between two refreshes of the same session. Not a fixed cadence —
 * refreshes are driven by *what changed* (see {@link shouldRefresh}); this only
 * stops one churning session from monopolizing the single model and starving the
 * others. Small, so supervision stays near real-time.
 */
export const MIN_REFRESH_GAP_MS = 10_000;

/** Cached summary plus the snapshot that decides when it is worth re-inferring. */
export interface SummaryState {
  summary: AgentSummary;
  /** Show the "Summarizing…" placeholder — only on the first compute, so a refresh keeps the old text. */
  loading: boolean;
  /** Session mtime this summary reflects. */
  mtime: number;
  /** User-turn count when summarized — a new turn is a new instruction, worth a refresh. */
  turnCount: number;
  /** Distilled action when summarized — a changed action means the agent moved on. */
  action: string;
  /** Timestamp of the last request/completion; anchors the {@link MIN_REFRESH_GAP_MS} floor. */
  at: number;
}

/**
 * A session is worth re-summarizing when its transcript has actually grown *and*
 * the agent has meaningfully moved — a new user turn, or a different distilled
 * action — not merely because the transcript grew (streamed text, repeated
 * same-tool calls). The floor keeps the single model fair across sessions.
 *
 * Deliberately blind to `state`. Gating on "working" starved exactly the cards
 * the user watches most: `classifySession` marks a session working only while it
 * is live, fresh AND the newest transcript in its project, so a session that has
 * just ended its turn ("idle", needs you) or that shares a project with a newer
 * one can never qualify — however much it moves. The three fields read here come
 * straight off the transcript and carry no such attribution.
 *
 * Requiring transcript growth is what keeps this from self-perpetuating: the
 * recorded action is the one seen when the refresh was queued, so without the
 * mtime conjunct a session that changed action mid-inference would stay eligible
 * on every later scan.
 */
export function shouldRefresh(tile: AgentTile, cur: SummaryState, now: number): boolean {
  if (now - cur.at < MIN_REFRESH_GAP_MS) return false;
  if (tile.lastActivityMs <= cur.mtime) return false;
  return tile.turnCount > cur.turnCount || tile.actionLine !== cur.action;
}
