import { execFile } from "node:child_process";
import type { HarnessAdapter, HarnessSessionRef, ParsedTranscript, FollowHandle } from "./harness-types.js";

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

/** Opaque `ses_…` ids; the regex doubles as the shell-arg sanitizer. */
const RESUMABLE_ID = /^ses_[A-Za-z0-9]+$/;

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

/**
 * Map one opencode export message to Claude's entry shape so the shared tile
 * pipeline (turns / action-distiller / session-state) consumes it unchanged.
 * Text parts → `text` blocks; tool parts → `tool_use` blocks (name + input).
 */
export function opencodeMessageToEntry(msg: ExportMessage): { message: { role: string; content: unknown[] } } | undefined {
  const role = msg.info?.role;
  if (role !== "user" && role !== "assistant") return undefined;
  const blocks: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }> = [];
  for (const p of msg.parts ?? []) {
    if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
      blocks.push({ type: "text", text: p.text });
    } else if (p.type === "tool" && p.tool) {
      blocks.push({ type: "tool_use", name: p.tool, input: p.state?.input ?? {} });
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
  id: "opencode",
  processNames: () => ["opencode"],
  isResumableId: (sessionId) => RESUMABLE_ID.test(sessionId),
  buildResumeArgs: (sessionId, fork) => (fork ? ["--session", sessionId, "--fork"] : ["--session", sessionId]),

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
      loadEntries: async () => opencodeExportToEntries(await exportSession(r.id)),
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
