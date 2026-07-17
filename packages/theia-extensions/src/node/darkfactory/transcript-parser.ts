/** Fields distilled from one Claude Code transcript (`.jsonl`). */
export interface ParsedTranscript {
  cwd?: string;
  gitBranch?: string;
  mode?: string;
  permissionMode?: string;
  userTurns: number;
  lastPrompt: string;
  lastTool?: string;
}

/** Text of a user message whose `content` is a string or an array of blocks. */
function userText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const t = content.find((b) => b && typeof b === "object" && (b as { type?: string }).type === "text");
    const text = (t as { text?: string } | undefined)?.text;
    if (typeof text === "string") return text;
  }
  return undefined;
}

/** Name of the last `tool_use` block in an assistant message, if any. */
function toolName(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i] as { type?: string; name?: string } | undefined;
    if (b?.type === "tool_use" && typeof b.name === "string") return b.name;
  }
  return undefined;
}

/**
 * Parse transcript lines into display fields. Lines that are not valid JSON, or
 * do not match a known shape, are skipped — never throw.
 */
export function parseTranscript(lines: string[]): ParsedTranscript {
  const out: ParsedTranscript = { userTurns: 0, lastPrompt: "" };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof e.cwd === "string") out.cwd = e.cwd;
    if (typeof e.gitBranch === "string") out.gitBranch = e.gitBranch;
    if (e.type === "mode" && typeof e.mode === "string") out.mode = e.mode;
    if (e.type === "permission-mode" && typeof e.permissionMode === "string") {
      out.permissionMode = e.permissionMode;
    }
    const msg = e.message as { role?: string; content?: unknown } | undefined;
    if (msg?.role === "user") {
      const text = userText(msg.content);
      if (typeof text === "string") {
        out.userTurns++;
        out.lastPrompt = text.replace(/\s+/g, " ").trim().slice(0, 200);
      }
    } else if (msg?.role === "assistant") {
      const tool = toolName(msg.content);
      if (tool) out.lastTool = tool;
    }
  }
  return out;
}
