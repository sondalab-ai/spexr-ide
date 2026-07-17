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

/** Compact "Verb target" for a tool call, e.g. "Editing auth.ts", "Running: pnpm test". */
function formatToolLine(name: string, input: Record<string, unknown> | undefined): { line: string; target?: string } {
  const target = toolTarget(name, input);
  const verb = VERB[name] ?? name;
  const line = name === "Bash" && target ? `Running: ${target}` : target ? `${verb} ${target}` : verb;
  return target !== undefined ? { line: line.slice(0, 80), target } : { line: line.slice(0, 80) };
}

/** Trivial shell programs that carry no signal in a trail. */
const TRIVIAL_BASH = new Set(["cd", "ls", "pwd", "echo", "export", "cat", "which", "clear", "true", ":", "set", "env", "source"]);

/** Strip leading `VAR=value` env assignments from a shell command. */
function stripEnv(cmd: string): string {
  return cmd.replace(/^(?:\w+=(?:"[^"]*"|'[^']*'|\S+)\s+)+/, "").trim();
}

/** Program + subcommand of a shell command, e.g. "git push", "gh pr", "pnpm test". */
function bashLabel(cmd: string): { program: string; label: string } {
  const c = stripEnv(cmd);
  const toks = c.split(/\s+/).filter(Boolean);
  const program = toks[0] ?? "";
  const meaningful = toks.slice(0, 3).filter((t) => !t.startsWith("-")).slice(0, 2);
  return { program, label: meaningful.join(" ") || program };
}

/** Short chip form for the recent-actions trail, e.g. "Edit auth.ts", "Bash git push". */
function formatChip(name: string, input: Record<string, unknown> | undefined): string {
  if (name === "Bash") {
    const cmd = typeof input?.command === "string" ? input.command : "";
    return `Bash ${bashLabel(cmd).label}`.slice(0, 32);
  }
  const target = toolTarget(name, input);
  return (target ? `${name} ${target}` : name).slice(0, 32);
}

/** True when a tool call is too low-signal to show in the trail. */
function isTrivial(name: string, input: Record<string, unknown> | undefined): boolean {
  if (name !== "Bash") return false;
  const cmd = typeof input?.command === "string" ? input.command : "";
  const { program } = bashLabel(cmd);
  return program === "" || TRIVIAL_BASH.has(program);
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
        const { line, target } = formatToolLine(b.name, b.input);
        const out: DistilledAction = { line, tool: b.name };
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

/**
 * The last `n` meaningful tool calls, chronological, as short chips
 * (e.g. ["Read x", "Edit y", "Bash pnpm test"]). Trivial shell commands
 * (cd/ls/echo…) and consecutive duplicates are dropped.
 */
export function recentActions(entries: DistillEntry[], n: number): string[] {
  const chips: string[] = [];
  for (const e of entries) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      const block = b as { type?: string; name?: string; input?: Record<string, unknown> };
      if (block.type !== "tool_use" || !block.name) continue;
      if (isTrivial(block.name, block.input)) continue;
      const chip = formatChip(block.name, block.input);
      if (chip !== chips[chips.length - 1]) chips.push(chip);
    }
  }
  return chips.slice(-n);
}

/** True when the most recent tool_result in the transcript is an error. */
export function lastActionFailed(entries: DistillEntry[]): boolean {
  for (let i = entries.length - 1; i >= 0; i--) {
    const content = entries[i]?.message?.content;
    if (!Array.isArray(content)) continue;
    for (let j = content.length - 1; j >= 0; j--) {
      const b = content[j] as { type?: string; is_error?: boolean };
      if (b.type === "tool_result") return b.is_error === true;
    }
  }
  return false;
}
