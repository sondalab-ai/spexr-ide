import type { SessionLink } from "../../common/darkfactory-protocol.js";
import type { TurnEntry } from "./turns.js";

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const PULL_REQUEST = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/g;
const LOCAL = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::(\d{2,5}))?(\/[^\s"'<>`)\]}]*)?/g;
/** Sentence punctuation that ends a URL written in prose. */
const TRAILING = /[.,;:!?]+$/;

/**
 * The web pages a session produced, newest mention first: pull requests on
 * GitHub (as printed by `gh pr create`) and local servers (as printed by a dev
 * server). Only what the session printed or wrote counts — tool results and
 * assistant text — not the commands it ran, which name URLs it merely used.
 */
export function extractLinks(entries: readonly TurnEntry[]): SessionLink[] {
  const lastSeen = new Map<string, { link: SessionLink; at: number }>();
  entries.forEach((entry, at) => {
    for (const text of producedText(entry)) {
      for (const link of linksIn(text)) lastSeen.set(link.url, { link, at });
    }
  });
  return [...lastSeen.values()].sort((a, b) => b.at - a.at).map((v) => v.link);
}

function linksIn(raw: string): SessionLink[] {
  const text = raw.replace(ANSI, "");
  const found: SessionLink[] = [];
  for (const m of text.matchAll(PULL_REQUEST)) {
    const [, owner, repo, n] = m;
    found.push({ kind: "pr", url: `https://github.com/${owner}/${repo}/pull/${n}`, label: `PR #${n} · ${repo}` });
  }
  for (const m of text.matchAll(LOCAL)) {
    const port = m[1] ? `:${m[1]}` : "";
    const path = (m[2] ?? "").replace(TRAILING, "");
    const scheme = m[0].startsWith("https") ? "https" : "http";
    const shownPath = path === "/" ? "" : path;
    found.push({ kind: "local", url: `${scheme}://localhost${port}${path}`, label: `localhost${port}${shownPath}` });
  }
  return found;
}

/** Text an entry shows the session producing: assistant prose and tool output. */
function producedText(entry: TurnEntry): string[] {
  const { role, content } = entry.message ?? {};
  if (typeof content === "string") return role === "assistant" ? [content] : [];
  if (!Array.isArray(content)) return [];
  const texts: string[] = [];
  for (const b of content) {
    const block = b as { type?: string; text?: string; content?: unknown };
    if (role === "assistant" && block.type === "text" && block.text) texts.push(block.text);
    if (block.type === "tool_result") texts.push(...resultTexts(block.content));
  }
  return texts;
}

function resultTexts(content: unknown): string[] {
  if (typeof content === "string") return [content];
  if (!Array.isArray(content)) return [];
  return content.map((b) => (b as { text?: string }).text ?? "").filter(Boolean);
}
