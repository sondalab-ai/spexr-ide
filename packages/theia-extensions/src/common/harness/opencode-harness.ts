import { execFile } from "node:child_process";
import type { HarnessAdapter, HarnessSessionRef, ParsedTranscript, FollowHandle } from "./harness-types.js";
import { opencodeCore } from "./opencode-harness-core.js";
import { once } from "./once.js";

/** One row of the `opencode db` session query. */
interface SessionRow {
  id: string;
  directory: string;
  parent_id: string | null;
  title: string;
  agent: string;
  model: string;
  time_created: number;
  time_updated: number;
}

/** Hardcoded against opencode 1.18.13 — never interpolate user input (spike R1). */
const SESSION_QUERY =
  "SELECT id, directory, parent_id, title, agent, model, time_created, time_updated FROM session ORDER BY time_updated DESC";

function runOpencode(args: string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("opencode", args, { timeout: timeoutMs, maxBuffer: 32 << 20 }, (err, stdout) => {
      if (err && !stdout) reject(err);
      else resolve(stdout);
    });
  });
}

/** One opencode export message: `{info:{role,…}, parts:[{type,text?,tool?,state?}]}`. */
interface ExportMessage {
  info?: { role?: string };
  parts?: Array<{ type?: string; text?: string; tool?: string; state?: { input?: Record<string, unknown>; status?: string } }>;
}

/** opencode tool name → Claude tool name, so the shared distiller renders known verbs. */
const TOOL_NAME: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  write: "Write",
  edit: "Edit",
  grep: "Grep",
  glob: "Glob",
  webfetch: "WebFetch",
  task: "Task",
};

/** opencode tool input key → Claude input key, so the shared distiller finds its target. */
const INPUT_KEY: Record<string, string> = {
  filePath: "file_path",
  pattern: "pattern",
  command: "command",
};

function mapToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    out[INPUT_KEY[k] ?? k] = v;
  }
  return out;
}

/**
 * Map one opencode export message to Claude's entry shape so the shared tile
 * pipeline (turns / action-distiller / session-state) consumes it unchanged.
 * Text parts → `text` blocks; tool parts → `tool_use` blocks with Claude tool
 * names and input keys (bash→Bash, filePath→file_path).
 */
export function opencodeMessageToEntry(msg: ExportMessage): { message: { role: string; content: unknown[] } } | undefined {
  const role = msg.info?.role;
  if (role !== "user" && role !== "assistant") return undefined;
  const blocks: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown>; is_error?: boolean }> = [];
  for (const p of msg.parts ?? []) {
    if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
      blocks.push({ type: "text", text: p.text });
    } else if (p.type === "tool" && p.tool) {
      const name = TOOL_NAME[p.tool.toLowerCase()] ?? p.tool;
      blocks.push({ type: "tool_use", name, input: mapToolInput(p.state?.input ?? {}) });
      // Emit a matching tool_result so `lastActionFailed` sees opencode failures
      // (state.status ∈ {completed, error}; a failed tool carries state.error).
      const status = p.state?.status;
      if (status === "completed" || status === "error") {
        blocks.push({ type: "tool_result", is_error: status === "error" });
      }
    }
  }
  if (!blocks.length) return undefined;
  return { message: { role, content: blocks } };
}

/**
 * The opencode harness. Sessions live in one SQLite database exposed through the
 * `opencode db` CLI (spike R1); transcripts come from `opencode export`. Live-
 * follow is Slice 5 — `followSession` fails fast until then.
 */
export const opencodeHarness: HarnessAdapter = {
  ...opencodeCore,

  async listSessions(): Promise<HarnessSessionRef[]> {
    let stdout: string;
    try {
      stdout = await runOpencode(["db", "--format", "json", SESSION_QUERY]);
    } catch {
      return []; // enumeration unavailable → modified-time-only liveness backstop
    }
    let rows: SessionRow[];
    try {
      rows = JSON.parse(stdout) as SessionRow[];
    } catch {
      return [];
    }
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => ({
      sessionId: r.id,
      projectPath: r.directory,
      mtimeMs: r.time_updated,
      loadEntries: once(async () => opencodeExportToEntries(await exportSession(r.id))),
    }));
  },

  async parseTranscript(ref: HarnessSessionRef): Promise<ParsedTranscript> {
    const entries = (await ref.loadEntries()) as Array<{ message: { role: string; content: unknown[] } }>;
    const out: ParsedTranscript = { cwd: ref.projectPath, userTurns: 0, goal: "", lastPrompt: "", interactive: true };
    for (const e of entries) {
      const role = e.message.role;
      const text = entryText(e.message.content);
      if (role === "user" && text.trim()) {
        out.userTurns++;
        const clean = text.replace(/\s+/g, " ").trim();
        out.lastPrompt = clean.slice(0, 200);
        if (!out.goal) out.goal = clean.slice(0, 2000);
      } else if (role === "assistant") {
        const tool = lastToolName(e.message.content);
        if (tool) out.lastTool = tool;
      }
    }
    return out;
  },

  followSession(): FollowHandle {
    throw new Error("opencode followSession is not implemented yet (Slice 5)");
  },
};

async function exportSession(sessionId: string): Promise<ExportMessage[]> {
  try {
    const stdout = await runOpencode(["export", sessionId], 30_000);
    const doc = JSON.parse(stdout) as { messages?: ExportMessage[] };
    return Array.isArray(doc.messages) ? doc.messages : [];
  } catch {
    return []; // export failed → empty transcript, tile still shows from the db row
  }
}

export function opencodeExportToEntries(messages: ExportMessage[]): Array<{ message: { role: string; content: unknown[] } }> {
  const out: Array<{ message: { role: string; content: unknown[] } }> = [];
  for (const m of messages) {
    const e = opencodeMessageToEntry(m);
    if (e) out.push(e);
  }
  return out;
}

function entryText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((b) => {
      const block = b as { type?: string; text?: string };
      return block.type === "text" ? (block.text ?? "") : "";
    })
    .join(" ");
}

function lastToolName(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i] as { type?: string; name?: string };
    if (b?.type === "tool_use" && typeof b.name === "string") return b.name;
  }
  return undefined;
}
