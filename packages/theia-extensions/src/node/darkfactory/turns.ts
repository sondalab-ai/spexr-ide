import { describeToolUse } from "./action-distiller.js";
import { isGenuinePrompt } from "./transcript-parser.js";
import type { FollowEvent } from "../../common/darkfactory-protocol.js";

/** One transcript entry, loosely typed (`isMeta` and `message` are read). */
export interface TurnEntry {
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Concatenated text of a message whose content is a string or block array. */
function textOf(content: unknown): string {
  if (typeof content === "string") return collapse(content);
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as { type?: string; text?: string };
        return block.type === "text" ? collapse(block.text ?? "") : "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** Text carried by a tool_result block (string or `{type:"text",text}` array). */
function resultText(content: unknown): string {
  if (typeof content === "string") return collapse(content);
  if (Array.isArray(content)) {
    return collapse(
      content.map((b) => ((b as { text?: string }).text ?? "")).join(" "),
    );
  }
  return "";
}

/**
 * Render one transcript entry into a single enriched line, or "" to drop it:
 *  - genuine user prompt  → `user: <text>`   (injected/meta prompts dropped)
 *  - assistant prose+calls → `assistant: <prose> [Edit auth.ts] [Bash: pnpm test]`
 *  - failed tool result    → `tool error: <snippet>`   (successes carry no extra signal)
 */
function renderEvent(entry: TurnEntry): string {
  const msg = entry.message;
  const role = msg?.role;
  const content = msg?.content;

  if (role === "assistant") {
    const segs: string[] = [];
    if (Array.isArray(content)) {
      for (const b of content) {
        const block = b as { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
        if (block.type === "text" && block.text?.trim()) segs.push(collapse(block.text));
        else if (block.type === "tool_use" && block.name) segs.push(`[${describeToolUse(block.name, block.input)}]`);
      }
    } else {
      const t = textOf(content);
      if (t) segs.push(t);
    }
    return segs.length ? `assistant: ${segs.join(" ")}` : "";
  }

  if (role === "user") {
    // A user message is either a tool_result carrier or a typed prompt.
    if (Array.isArray(content) && content.some((b) => (b as { type?: string }).type === "tool_result")) {
      const errs: string[] = [];
      for (const b of content) {
        const block = b as { type?: string; is_error?: boolean; content?: unknown };
        if (block.type === "tool_result" && block.is_error === true) {
          const snip = resultText(block.content).slice(0, 120);
          errs.push(snip ? `tool error: ${snip}` : "tool error");
        }
      }
      return errs.join("\n"); // all-success → "" → dropped (the tool_use line already says what ran)
    }
    const t = textOf(content);
    if (t && isGenuinePrompt(entry.isMeta === true, t)) return `user: ${t.slice(0, 240)}`;
    return "";
  }

  return "";
}

/**
 * Render the session as enriched `role: …` lines for the summary/follow prompt.
 * Keeps the last `maxEvents` events and always prepends the session goal (the
 * first genuine user prompt) so the model stays grounded in the objective even
 * when the recent tail is all tool activity.
 */
export function buildTurnsText(entries: TurnEntry[], maxEvents: number): string {
  const events: string[] = [];
  for (const e of entries) {
    const line = renderEvent(e);
    if (line) events.push(line);
  }
  const tail = events.slice(-maxEvents);
  const goal = events.find((l) => l.startsWith("user: "));
  if (goal && !tail.includes(goal)) tail.unshift(goal);
  return tail.join("\n");
}

/** The session goal: the text of the first genuine user prompt ("" when none). */
export function sessionGoal(entries: TurnEntry[]): string {
  for (const e of entries) {
    const msg = e.message;
    if (msg?.role !== "user") continue;
    const content = msg.content;
    if (Array.isArray(content) && content.some((b) => (b as { type?: string }).type === "tool_result")) continue;
    const t = textOf(content);
    if (t && isGenuinePrompt(e.isMeta === true, t)) return t;
  }
  return "";
}

/** Follow-view text for a tool call: the raw shell command for Bash, else "Name target". */
function toolText(name: string, input: Record<string, unknown> | undefined): string {
  if (name === "Bash") {
    const cmd = typeof input?.command === "string" ? input.command.trim() : "";
    return cmd ? cmd.slice(0, 600) : "Bash";
  }
  return describeToolUse(name, input);
}

/**
 * Render transcript entries into typed {@link FollowEvent}s for the read-only
 * follow — unlike {@link buildTurnsText} (a compact single-line-per-turn digest
 * for the model), this keeps each prompt, assistant reply, tool call, and tool
 * result as its own event so the UI can lay them out like a terminal. Keeps the
 * last `maxEvents` events; the follow streams incrementally so this only caps the
 * initial backfill.
 */
export function buildFollowEvents(entries: TurnEntry[], maxEvents: number): FollowEvent[] {
  const events: FollowEvent[] = [];
  for (const e of entries) {
    const msg = e.message;
    const content = msg?.content;

    if (msg?.role === "assistant") {
      if (Array.isArray(content)) {
        for (const b of content) {
          const block = b as { type?: string; text?: string; name?: string; input?: Record<string, unknown> };
          if (block.type === "text" && block.text?.trim()) events.push({ kind: "assistant", text: collapse(block.text) });
          else if (block.type === "tool_use" && block.name) events.push({ kind: "tool", text: toolText(block.name, block.input) });
        }
      } else {
        const t = textOf(content);
        if (t) events.push({ kind: "assistant", text: t });
      }
      continue;
    }

    if (msg?.role === "user") {
      if (Array.isArray(content) && content.some((b) => (b as { type?: string }).type === "tool_result")) {
        for (const b of content) {
          const block = b as { type?: string; is_error?: boolean; content?: unknown };
          if (block.type !== "tool_result") continue;
          const isError = block.is_error === true;
          const snip = collapse(resultText(block.content)).slice(0, isError ? 400 : 200);
          if (snip) events.push({ kind: isError ? "error" : "result", text: snip });
        }
      } else {
        const t = textOf(content);
        if (t && isGenuinePrompt(e.isMeta === true, t)) events.push({ kind: "prompt", text: t.slice(0, 2000) });
      }
    }
  }
  return events.slice(-maxEvents);
}
