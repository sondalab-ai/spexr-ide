/** Tools that can trigger a permission prompt. */
const PERMISSION_TOOLS = new Set(["Bash", "Edit", "Write", "WebFetch"]);
const SETTLE_MS = 2_000;

interface NeedsYouEntry {
  message?: { role?: string; content?: unknown };
}

/**
 * Best-effort guess that an external live session is waiting for the user: its
 * last entry is a permission-requiring tool-use and no write has landed for
 * `SETTLE_MS` (so it is not mid-stream). Heuristic — the real prompt lives in
 * the process TTY, not the transcript.
 */
export function guessNeedsYou(
  entries: NeedsYouEntry[],
  isLive: boolean,
  mtimeMs: number,
  nowMs: number,
): boolean {
  if (!isLive || nowMs - mtimeMs < SETTLE_MS) return false;
  const last = entries[entries.length - 1]?.message;
  if (last?.role !== "assistant" || !Array.isArray(last.content)) return false;
  const tail = last.content[last.content.length - 1] as { type?: string; name?: string };
  return tail?.type === "tool_use" && !!tail.name && PERMISSION_TOOLS.has(tail.name);
}
