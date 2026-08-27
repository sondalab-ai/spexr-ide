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
/** Permission modes that auto-approve tools, so a pending tool_use is work, not a prompt. */
const AUTO_APPROVE_MODES = new Set(["auto", "bypassPermissions"]);

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

/** A genuine conversation message (not injected meta, not a typed metadata record). */
function isRealMessage(e: StateEntry | undefined): boolean {
  const role = e?.message?.role;
  return !e?.isMeta && (role === "user" || role === "assistant");
}

/**
 * The interrupt marker a harness appends when the human aborts the turn (ESC).
 * Claude Code writes it UNWRAPPED (top-level `role`/`content`, no `message`
 * envelope), so the normal real-message check skips it and the turn would look
 * like it is still acting. Tolerant of both shapes so any harness that emits the
 * marker is classified correctly.
 */
function isInterruptMarker(e: StateEntry | undefined): boolean {
  if (!e) return false;
  const em = e as { role?: string; content?: unknown; message?: { role?: string; content?: unknown } };
  const role = em.message?.role ?? em.role;
  if (role !== "user") return false;
  const content = em.message?.content ?? em.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((b) => (typeof (b as { text?: string })?.text === "string" ? (b as { text?: string }).text : "")).join(" ")
        : "";
  return text.trim().startsWith("[Request interrupted");
}

/**
 * Where a live session's turn stands, from its last real conversation message:
 * - acting: a user message (a prompt or a tool_result to act on), an assistant
 *   `tool_use` for a non-permission tool, or a still-streaming assistant message
 *   (last block is `thinking`) → the agent is doing work.
 * - permission: an assistant `tool_use` for a permission tool → the agent may be
 *   blocked on a prompt (confirmed only once it has stalled).
 * - ended: an assistant `text` reply → the turn is over, awaiting the human.
 *
 * Non-message trailing entries are skipped: injected meta, and the typed metadata
 * records Claude Code appends after the final reply (last-prompt, ai-title, mode,
 * permission-mode, system). Without this, a finished turn's trailing metadata
 * masks the assistant's closing text and the session looks like it is still working.
 */
function lastTurn(entries: StateEntry[]): Turn {
  let i = entries.length - 1;
  while (i >= 0) {
    // An interrupt marker after the last real message means the turn was aborted
    // mid-work and the session is back at the prompt — not still working.
    if (isInterruptMarker(entries[i])) return "ended";
    if (isRealMessage(entries[i])) break;
    i--;
  }
  if (i < 0) return "unknown";
  const last = entries[i]?.message;
  if (!last) return "unknown";
  if (last.role === "user") return "acting";
  if (!Array.isArray(last.content)) return "unknown";
  const tail = last.content[last.content.length - 1] as { type?: string; name?: string };
  if (tail?.type === "tool_use") {
    return tail.name && PERMISSION_TOOLS.has(tail.name) ? "permission" : "acting";
  }
  if (tail?.type === "text") return "ended";
  return "acting"; // thinking / partial block → still generating
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
  permissionMode?: string,
): SessionStatus {
  const live = !!liveDirs?.has(projectPath) && isNewestInProject;
  const gap = nowMs - mtimeMs;
  if (live && gap <= STALE_MS) {
    const turn = lastTurn(entries);
    // A live session that awaits the human is not "working" (no green pulse); the
    // needsYou flag drives the attention styling instead. Under an auto-approving
    // permission mode a pending tool_use is not a prompt — the agent is working.
    const blocked = turn === "permission" && !AUTO_APPROVE_MODES.has(permissionMode ?? "");
    if (blocked && gap >= SETTLE_MS) return { state: "idle", needsYou: true, needsYouCertain: true };
    if (turn === "ended") return { state: "idle", needsYou: true, needsYouCertain: false };
    return { state: "working", needsYou: false, needsYouCertain: false };
  }
  // Not live, or a live process gone dormant → paused (recent) or done (old).
  const state: AgentState = gap <= IDLE_WINDOW_MS ? "idle" : "done";
  return { state, needsYou: false, needsYouCertain: false };
}
