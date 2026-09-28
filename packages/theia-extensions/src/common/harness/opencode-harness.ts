import { spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessAdapter, HarnessSessionRef, ParsedTranscript, FollowHandle } from "./harness-types.js";
import { opencodeCore } from "./opencode-harness-core.js";
import { once } from "./once.js";
import { STALE_MS } from "../session-timing.js";

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

/**
 * opencode (Bun) truncates stdout written to a PIPE at ~128 KiB — the tail is
 * never flushed when the process exits, so a large `opencode export` payload
 * arrives as corrupted JSON (verified: 2.9 MB session truncated at exactly
 * 131072 bytes; file redirect unaffected). Spawn with stdout redirected to a
 * temp file and read it back; callers stay fail-soft on the parse downstream.
 */
function runOpencode(args: string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const outFile = join(tmpdir(), `spexr-opencode-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.out`);
    let fd: number;
    try {
      fd = openSync(outFile, "w");
    } catch (err) {
      reject(err);
      return;
    }
    const child = spawn("opencode", args, { stdio: ["ignore", fd, "ignore"], timeout: timeoutMs });
    let settled = false;
    const done = (err: Error | null): void => {
      if (settled) return;
      settled = true;
      try {
        closeSync(fd);
      } catch {
        /* already closed */
      }
      let out = "";
      try {
        out = readFileSync(outFile, "utf8");
      } catch {
        /* missing/unreadable → resolve empty, callers fail soft */
      }
      try {
        unlinkSync(outFile);
      } catch {
        /* best effort */
      }
      if (err) reject(err);
      else resolve(out);
    };
    child.once("error", done);
    child.once("close", (code) => done(code === 0 ? null : new Error(`opencode ${args[0]} exited with code ${code}`)));
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

type Entries = Array<{ message: { role: string; content: unknown[] } }>;

/** Exports kept per harness; the Dark Factory wall reads at most 60 sessions a scan. */
const EXPORT_CACHE_MAX = 100;

/** Runs the opencode CLI and resolves its stdout; injected in tests. */
export type OpencodeRunner = (args: string[], timeoutMs?: number) => Promise<string>;

/**
 * The opencode harness. Sessions live in one SQLite database exposed through the
 * `opencode db` CLI (spike R1); transcripts come from `opencode export`. Live-
 * follow is Slice 5 — `followSession` fails fast until then.
 */
export function createOpencodeHarness(run: OpencodeRunner = runOpencode, now: () => number = Date.now): HarnessAdapter {
  const exports = exportCache(run, now);
  return {
    ...opencodeCore,

    async listSessions(): Promise<HarnessSessionRef[]> {
      let stdout: string;
      try {
        stdout = await run(["db", "--format", "json", SESSION_QUERY]);
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
      exports.keepOnly(new Set(rows.map((r) => r.id)));
      return rows.map((r) => ({
        sessionId: r.id,
        projectPath: r.directory,
        mtimeMs: r.time_updated,
        loadEntries: once(() => exports.load(r.id, r.time_updated)),
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
}

export const opencodeHarness: HarnessAdapter = createOpencodeHarness();

/**
 * `opencode export` costs a full CPU for seconds, and the wall re-lists every
 * few seconds. opencode bumps a session's `time_updated` once per step, not
 * per message, so a session updated within {@link STALE_MS} (the window in
 * which the wall reads a live session's transcript) is exported on every
 * read. A dormant one's export is kept while its `time_updated` stays the
 * same, so it is exported once. Failures are not kept: a finished session
 * never changes again, and would otherwise stay empty. Least recently read
 * sessions go first past {@link EXPORT_CACHE_MAX}.
 */
function exportCache(run: OpencodeRunner, now: () => number): {
  load(sessionId: string, updated: number): Promise<Entries>;
  keepOnly(listed: Set<string>): void;
} {
  const cache = new Map<string, { updated: number; entries: Promise<Entries> }>();
  return {
    load(sessionId, updated) {
      if (now() - updated <= STALE_MS) {
        cache.delete(sessionId);
        return exportSession(run, sessionId).then(opencodeExportToEntries, () => []);
      }
      let hit = cache.get(sessionId);
      cache.delete(sessionId);
      if (hit?.updated !== updated) {
        const entry = { updated, entries: exportSession(run, sessionId).then(opencodeExportToEntries) };
        entry.entries.catch(() => {
          if (cache.get(sessionId) === entry) cache.delete(sessionId);
        });
        hit = entry;
      }
      cache.set(sessionId, hit);
      for (const oldest of cache.keys()) {
        if (cache.size <= EXPORT_CACHE_MAX) break;
        cache.delete(oldest);
      }
      return hit.entries.catch(() => []);
    },
    keepOnly(listed) {
      for (const id of cache.keys()) if (!listed.has(id)) cache.delete(id);
    },
  };
}

/** One session's export; rejects when the CLI fails or prints something that is not JSON. */
async function exportSession(run: OpencodeRunner, sessionId: string): Promise<ExportMessage[]> {
  const doc = JSON.parse(await run(["export", sessionId], 30_000)) as { messages?: ExportMessage[] };
  return Array.isArray(doc.messages) ? doc.messages : [];
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
