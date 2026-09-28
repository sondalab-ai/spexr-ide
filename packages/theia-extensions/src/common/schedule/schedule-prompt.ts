import type { ScheduleTask } from "./schedule-types.js";

export const CONVERGED_MARKER = "CONVERGED";
/** An upstream reply is cut to this length before it goes into a prompt. */
export const MAX_REPLY_CHARS = 8_000;

const PLACEHOLDER = /\{\{\s*([a-z0-9-]{1,32})\.(reply|workspace)\s*\}\}/g;

const MARKER_INSTRUCTION =
  `When, and only when, the criteria above are met, end your reply with a line containing only ${CONVERGED_MARKER}. ` +
  `Until then, never end a reply with that line.`;
const MARKER_REMINDER = `End your reply with a line containing only ${CONVERGED_MARKER} once the stop criteria are met.`;

/** The `{{task.field}}` references in a prompt, in order. */
export function placeholdersIn(text: string): { task: string; field: "reply" | "workspace" }[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => ({ task: m[1]!, field: m[2] as "reply" | "workspace" }));
}

/**
 * Replace every reference with what `lookup` gives, or nothing. A reply longer
 * than MAX_REPLY_CHARS is cut, and the cut is stated so the reading agent knows.
 */
export function fillPlaceholders(
  text: string,
  lookup: (task: string, field: "reply" | "workspace") => string | undefined,
): string {
  return text.replace(PLACEHOLDER, (_m, task: string, field: "reply" | "workspace") => {
    const value = lookup(task, field) ?? "";
    if (field !== "reply" || value.length <= MAX_REPLY_CHARS) return value;
    return `${value.slice(0, MAX_REPLY_CHARS)}\n[reply cut to ${MAX_REPLY_CHARS} characters]`;
  });
}

/** The prompt a task starts with: its own text, then — when it loops — its stop criteria and the marker rule. */
export function firstPrompt(task: ScheduleTask, filled: string): string {
  if (!task.loop) return filled;
  return `${filled}\n\n## When to stop\n\n${task.loop.stopCriteria}\n\n${MARKER_INSTRUCTION}`;
}

/** What is pasted on every later iteration; a failed check's output is carried along. */
export function followUpPrompt(task: ScheduleTask, checkFailure?: { command: string; tail: string }): string {
  const parts = [task.loop?.followUp ?? ""];
  if (checkFailure) {
    parts.push(
      `You ended with ${CONVERGED_MARKER}, but the check \`${checkFailure.command}\` failed. The last lines of its output:\n\n\`\`\`\n${checkFailure.tail}\n\`\`\``,
    );
  }
  parts.push(MARKER_REMINDER);
  return parts.join("\n\n");
}

function lastLine(reply: string): string {
  const lines = reply.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/** True when the reply's last non-empty line is the marker, allowing `*`, `_` and backticks around it. */
export function hasConverged(reply: string): boolean {
  return lastLine(reply).replace(/[*_`]/g, "") === CONVERGED_MARKER;
}

/** The reply without its closing marker line, trimmed. */
export function stripMarker(reply: string): string {
  const trimmed = reply.trimEnd();
  if (!hasConverged(trimmed)) return trimmed;
  return trimmed.slice(0, trimmed.lastIndexOf("\n") + 1).trimEnd();
}
