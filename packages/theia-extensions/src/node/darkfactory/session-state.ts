import type { AgentState } from "../../common/darkfactory-protocol.js";

const IDLE_WINDOW_MS = 12 * 3_600_000;

interface StateEntry {
  message?: { role?: string; content?: unknown };
}

/**
 * True while the assistant still owes a response — i.e. the session is mid-turn:
 * - last entry is a user message (a real prompt or a tool_result the assistant
 *   must now act on), or
 * - last entry is an assistant message ending in a `tool_use` (a tool is running
 *   or a permission prompt is pending).
 * False once the assistant has ended its turn with a text reply, so it is waiting
 * on the human rather than doing work. This is the signal that a *live* process is
 * actually working vs. just sitting open — it does not depend on write recency, so
 * a long inference or a slow tool no longer looks idle.
 */
export function isTurnOpen(entries: StateEntry[]): boolean {
  const last = entries[entries.length - 1]?.message;
  if (!last) return false;
  if (last.role === "user") return true;
  if (last.role !== "assistant" || !Array.isArray(last.content)) return false;
  const tail = last.content[last.content.length - 1] as { type?: string };
  return tail?.type === "tool_use";
}

/**
 * Classify a session at project granularity.
 * - working: a live `claude` process runs in the project, this is the project's
 *   newest transcript, and the assistant is mid-turn ({@link isTurnOpen}).
 * - idle: written within the idle window but not currently working.
 * - done: older, not working.
 * `liveDirs` is `null` when process scanning failed → never "working".
 */
export function classifySession(
  projectPath: string,
  mtimeMs: number,
  isNewestInProject: boolean,
  liveDirs: Set<string> | null,
  nowMs: number,
  turnOpen: boolean,
): AgentState {
  const live = !!liveDirs?.has(projectPath) && isNewestInProject;
  if (live && turnOpen) return "working";
  if (nowMs - mtimeMs <= IDLE_WINDOW_MS) return "idle";
  return "done";
}
