import { open } from "node:fs/promises";
import { isGenuinePrompt } from "./transcript-parser.js";

/**
 * How far into a transcript the first genuine prompt is looked for. The wall's
 * bounded read stops at 32 KB, which a long injected preamble — a project's
 * CLAUDE.md, system reminders, hook output — can exhaust before the human's
 * first sentence appears; the session then indexes with no goal at all, losing
 * the field a query matches best. The crawl runs in the background, so it can
 * afford to read further than the wall does.
 */
const GOAL_HEAD_BYTES = 262_144;
/** The goal is a sentence, not a document; anything past this adds no signal. */
const MAX_GOAL_CHARS = 2000;

interface Entry {
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
}

/** Text of a user message whose content is a string or an array of blocks. */
function userText(content: unknown): string {
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  if (!Array.isArray(content)) return "";
  if (content.some((b) => (b as { type?: string })?.type === "tool_result")) return "";
  return content
    .filter((b) => (b as { type?: string })?.type === "text")
    .map((b) => String((b as { text?: string }).text ?? ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The first thing the human actually asked for, read from the head of a Claude
 * transcript. Returns "" when the file is unreadable or holds no genuine prompt
 * within the window.
 */
export async function readFirstPrompt(
  path: string,
  headBytes: number = GOAL_HEAD_BYTES,
): Promise<string> {
  let fh;
  try {
    fh = await open(path, "r");
  } catch {
    return "";
  }
  try {
    const { size } = await fh.stat();
    const length = Math.min(size, headBytes);
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, 0);
    const lines = buf.toString("utf8").split("\n");
    if (length < size) lines.pop(); // the last line straddles the cut
    for (const line of lines) {
      let entry: Entry;
      try {
        entry = JSON.parse(line) as Entry;
      } catch {
        continue;
      }
      if (entry.message?.role !== "user") continue;
      const text = userText(entry.message.content);
      if (text && isGenuinePrompt(entry.isMeta === true, text)) return text.slice(0, MAX_GOAL_CHARS);
    }
    return "";
  } catch {
    return "";
  } finally {
    await fh.close();
  }
}
