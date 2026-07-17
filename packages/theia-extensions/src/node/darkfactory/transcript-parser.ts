/** Fields distilled from one Claude Code transcript (`.jsonl`). */
export interface ParsedTranscript {
  cwd?: string;
  gitBranch?: string;
  mode?: string;
  permissionMode?: string;
  userTurns: number;
  /** First genuine human instruction — the session's goal (injected/meta skipped). */
  goal: string;
  lastPrompt: string;
  lastTool?: string;
  /**
   * True for interactive TUI sessions (they emit `mode`/`permission-mode` or a
   * SessionStart hook). SDK / `-p` one-shot sessions don't — used to filter the
   * automated subagent flood out of the wall.
   */
  interactive: boolean;
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

/** Injected/system prompt prefixes that are not the user's own instruction. */
const INJECTION_PREFIXES = [
  "Base directory for this skill",
  "## Context",
  "[Request interrupted",
  "Caveat:",
  "<",
];

/** True when a user message is a genuine typed instruction (not injected/meta). */
function isGenuinePrompt(isMeta: boolean, text: string): boolean {
  if (isMeta) return false;
  const t = text.trim();
  if (!t) return false;
  return !INJECTION_PREFIXES.some((p) => t.startsWith(p));
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
  const out: ParsedTranscript = { userTurns: 0, goal: "", lastPrompt: "", interactive: false };
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
    if (e.type === "mode" && typeof e.mode === "string") {
      out.mode = e.mode;
      out.interactive = true;
    }
    if (e.type === "permission-mode" && typeof e.permissionMode === "string") {
      out.permissionMode = e.permissionMode;
      out.interactive = true;
    }
    const msg = e.message as { role?: string; content?: unknown } | undefined;
    if (msg?.role === "user") {
      const text = userText(msg.content);
      if (typeof text === "string" && isGenuinePrompt(e.isMeta === true, text)) {
        out.userTurns++;
        const clean = text.replace(/\s+/g, " ").trim();
        out.lastPrompt = clean.slice(0, 200);
        if (!out.goal) out.goal = clean.slice(0, 2000); // full-ish for expand
      }
    } else if (msg?.role === "assistant") {
      const tool = toolName(msg.content);
      if (tool) out.lastTool = tool;
    }
  }
  return out;
}
