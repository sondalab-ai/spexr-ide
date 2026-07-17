/** One transcript entry, loosely typed (only `message` is read). */
export interface TurnEntry {
  message?: { role?: string; content?: unknown };
}

function renderContent(content: unknown): string {
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as { type?: string; text?: string; name?: string };
        if (block.type === "text") return (block.text ?? "").replace(/\s+/g, " ").trim();
        if (block.type === "tool_use") return `[tool_use: ${block.name ?? "?"}]`;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/**
 * Render the last `maxTurns` user/assistant turns as `role: text` lines, for the
 * summary prompt. Tool calls become `[tool_use: Name]` so the model can describe
 * what the agent is doing even when there is no prose.
 */
export function buildTurnsText(entries: TurnEntry[], maxTurns: number): string {
  const turns = entries
    .filter((e) => e.message?.role === "user" || e.message?.role === "assistant")
    .slice(-maxTurns)
    .map((e) => `${e.message!.role}: ${renderContent(e.message!.content)}`.trim())
    .filter((l) => !l.endsWith(":"));
  return turns.join("\n");
}
