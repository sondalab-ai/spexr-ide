import { basename, sep } from "node:path";
import type { TurnEntry } from "./turns.js";

/** Everything one session contributes to its indexable document. */
export interface SessionDocInput {
  projectPath: string;
  gitBranch?: string;
  goal: string;
  prose: string[];
  targets: string[];
}

/**
 * Document cap. Long enough to hold a goal, several prose segments and a real
 * spread of touched files; short enough that a thousand of them stay a few
 * megabytes on disk.
 */
const MAX_DOC_CHARS = 4000;
/** Tool targets kept per session — beyond this they stop identifying the work. */
const MAX_TARGETS = 40;

/**
 * The last two segments of a project path (`…/src/mine/spexr` → `mine/spexr`).
 * The parent segment is what tells two same-named checkouts apart.
 */
export function projectTail(projectPath: string): string {
  const parts = projectPath.split(sep).filter(Boolean);
  return parts.slice(-2).join("/");
}

/**
 * The distinct things a session acted on: file paths, search patterns, and the
 * leading word of each shell command. These carry the literal terms — file
 * names, tool names — that the lexical half of the hybrid score matches on.
 */
export function toolTargets(entries: TurnEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as { type?: string; input?: Record<string, unknown> };
      if (b.type !== "tool_use" || !b.input) continue;
      const path = b.input["file_path"];
      const pattern = b.input["pattern"];
      const command = b.input["command"];
      if (typeof path === "string" && path) seen.add(path);
      if (typeof command === "string" && command.trim()) seen.add(command.trim().split(/\s+/)[0]!);
      if (typeof pattern === "string" && pattern) seen.add(pattern);
    }
  }
  return [...seen];
}

/**
 * Build the text that represents one session in the index. The goal leads, so a
 * document hitting the cap loses tool targets rather than the sentence that
 * identifies the session.
 */
export function buildSessionDoc(input: SessionDocInput): string {
  const parts = [
    input.goal.trim(),
    basename(input.projectPath),
    projectTail(input.projectPath),
    input.gitBranch?.trim() ?? "",
    ...input.prose.map((p) => p.trim()),
    input.targets.slice(0, MAX_TARGETS).join(" "),
  ].filter(Boolean);
  return parts.join("\n").slice(0, MAX_DOC_CHARS);
}
