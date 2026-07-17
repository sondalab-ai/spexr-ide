import { basename } from "node:path";

/** One transcript entry, loosely typed (only `message` is read). */
export interface DistillEntry {
  message?: { role?: string; content?: unknown };
}

export interface DistilledAction {
  line: string;
  tool?: string;
  target?: string;
}

const VERB: Record<string, string> = {
  Edit: "Editing",
  Write: "Writing",
  Read: "Reading",
  Bash: "Running",
  Grep: "Searching",
  Glob: "Finding",
  Task: "Delegating",
  WebFetch: "Fetching",
};

function toolTarget(name: string, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  if (name === "Bash") return typeof input.command === "string" ? input.command : undefined;
  const p = input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description;
  if (typeof p === "string") return name === "Edit" || name === "Write" || name === "Read" ? basename(p) : p;
  return undefined;
}

/** Distil the last meaningful transcript entry into one human action line. */
export function distillAction(entries: DistillEntry[]): DistilledAction {
  for (let i = entries.length - 1; i >= 0; i--) {
    const content = entries[i]?.message?.content;
    if (!Array.isArray(content)) {
      if (typeof content === "string" && content.trim()) {
        return { line: content.replace(/\s+/g, " ").trim().slice(0, 80) };
      }
      continue;
    }
    for (let j = content.length - 1; j >= 0; j--) {
      const b = content[j] as { type?: string; name?: string; text?: string; input?: Record<string, unknown> };
      if (b.type === "tool_use" && b.name) {
        const target = toolTarget(b.name, b.input);
        const verb = VERB[b.name] ?? `${b.name}`;
        const line = b.name === "Bash" && target ? `Running: ${target}` : target ? `${verb} ${target}` : verb;
        const out: DistilledAction = { line: line.slice(0, 80), tool: b.name };
        if (target !== undefined) out.target = target;
        return out;
      }
      if (b.type === "text" && b.text?.trim()) {
        return { line: b.text.replace(/\s+/g, " ").trim().slice(0, 80) };
      }
    }
  }
  return { line: "No activity yet" };
}
