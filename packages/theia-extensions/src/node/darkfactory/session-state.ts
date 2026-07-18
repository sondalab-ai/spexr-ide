import type { AgentState } from "../../common/darkfactory-protocol.js";

const IDLE_WINDOW_MS = 12 * 3_600_000;
/** A tool_use must sit unresolved this long before we call it a pending prompt. */
const SETTLE_MS = 2_000;
/**
 * A live session whose transcript has not been written for this long is dormant,
 * not working: real work (tools, inferences) writes far more often, so a longer
 * silence means the process is stuck at a prompt or was abandoned mid-turn. This
 * caps the "working" state so a leftover `claude` process does not pulse forever.
 */
const STALE_MS = 10 * 60_000;
/** Tools whose use pauses the agent on a permission prompt. */
const PERMISSION_TOOLS = new Set(["Bash", "Edit", "Write", "WebFetch"]);

interface StateEntry {
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

/** Resolved status of a session: its coarse state plus whether it's the human's move. */
export interface SessionStatus {
  /** working = active, idle = paused (no live process, recent), done = old. */
  state: AgentState;
  /** The agent is blocked on the human (a permission prompt or an ended turn). */
  needsYou: boolean;
  /** A permission prompt is definitely blocking (vs. merely awaiting the next prompt). */
  needsYouCertain: boolean;
}

type Turn = "acting" | "permission" | "ended" | "unknown";

/**
 * Where a live session's turn stands, from its last real transcript entry:
 * - acting: last entry is a user message (a prompt or a tool_result to act on) or
 *   an assistant `tool_use` for a non-permission tool → the agent is doing work.
 * - permission: last entry is an assistant `tool_use` for a permission tool → the
 *   agent may be blocked on a prompt (confirmed only once it has stalled).
 * - ended: last entry is an assistant text reply → the turn is over, awaiting the human.
 * Trailing meta entries (injected reminders) are skipped — they are not real turns.
 */
function lastTurn(entries: StateEntry[]): Turn {
  let i = entries.length - 1;
  while (i >= 0 && entries[i]!.isMeta) i--;
  const last = entries[i]?.message;
  if (!last) return "unknown";
  if (last.role === "user") return "acting";
  if (last.role !== "assistant" || !Array.isArray(last.content)) return "unknown";
  const tail = last.content[last.content.length - 1] as { type?: string; name?: string };
  if (tail?.type === "tool_use") {
    return tail.name && PERMISSION_TOOLS.has(tail.name) ? "permission" : "acting";
  }
  return "ended";
}

/**
 * Classify a session at project granularity.
 *
 * A **live** session (a `claude` process runs in the project and this is the
 * project's newest transcript) is never "idle": it is either **working** (its turn
 * is open) or **needs you** (blocked on a permission prompt, or its turn ended and
 * it awaits the next instruction). This is what keeps the wall stable — a live
 * agent no longer flickers working⇄idle between turns, and "idle" is reserved for
 * a genuinely paused session with no running process.
 *
 * `liveDirs` is `null` when process scanning failed → never "working"/"needs you".
 */
export function classifySession(
  projectPath: string,
  mtimeMs: number,
  isNewestInProject: boolean,
  liveDirs: Set<string> | null,
  nowMs: number,
  entries: StateEntry[],
): SessionStatus {
  const live = !!liveDirs?.has(projectPath) && isNewestInProject;
  const gap = nowMs - mtimeMs;
  if (live && gap <= STALE_MS) {
    const turn = lastTurn(entries);
    // A live session that awaits the human is not "working" (no green pulse); the
    // needsYou flag drives the attention styling instead.
    if (turn === "permission" && gap >= SETTLE_MS) return { state: "idle", needsYou: true, needsYouCertain: true };
    if (turn === "ended") return { state: "idle", needsYou: true, needsYouCertain: false };
    return { state: "working", needsYou: false, needsYouCertain: false };
  }
  // Not live, or a live process gone dormant → paused (recent) or done (old).
  const state: AgentState = gap <= IDLE_WINDOW_MS ? "idle" : "done";
  return { state, needsYou: false, needsYouCertain: false };
}
