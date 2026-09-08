import { basename } from "node:path";
import { createHash } from "node:crypto";
import { forEachConcurrent } from "./concurrency.js";
import { buildSessionDoc, toolTargets } from "./session-doc.js";
import { recentAssistantProse, sessionGoal, type TurnEntry } from "./turns.js";
import type { SessionIndex, SessionRecord } from "./session-index.js";
import type { HarnessId, ParsedTranscript } from "../../common/harness/harness-types.js";

/**
 * One session the crawl can index, flattened out of its harness ref. The project
 * path is not a field: Claude refs carry none, and the real working directory
 * only appears once the transcript is parsed — hence `parse`, which the crawl
 * calls solely for sessions it has decided to index.
 */
export interface IndexableSession {
  sessionId: string;
  harness: HarnessId;
  transcriptPath: string;
  configDir: string;
  mtimeMs: number;
  loadEntries(): Promise<unknown[]>;
  parse(): Promise<ParsedTranscript>;
}

export interface SessionIndexerDeps {
  index: SessionIndex;
  embed(texts: string[]): Promise<Float32Array[]>;
  list(): Promise<IndexableSession[]>;
  save(index: SessionIndex): Promise<void>;
  onProgress?(done: number, total: number): void;
  now?(): number;
}

/** Documents per embedding call — the encoder batches well, memory stays flat. */
export const EMBED_BATCH = 16;
/** Transcripts parsed at once, matching the wall scan's own fan-out. */
const PARSE_CONCURRENCY = 8;
/** Assistant prose segments kept per session document. */
export const PROSE_SEGMENTS = 6;
/** Never persist more often than this while a crawl runs. */
const SAVE_INTERVAL_MS = 5_000;

/** Stable content key: an mtime touch that left the text alone skips the encoder. */
function hashDoc(doc: string): string {
  return createHash("sha1").update(doc).digest("hex");
}

/** Assemble one index record around an already-computed document and vector. */
function toRecord(
  session: IndexableSession,
  projectPath: string,
  vector: Float32Array,
  doc: string,
  goal: string,
): SessionRecord {
  return {
    sessionId: session.sessionId,
    harness: session.harness,
    projectPath,
    projectName: basename(projectPath),
    transcriptPath: session.transcriptPath,
    configDir: session.configDir,
    mtimeMs: session.mtimeMs,
    docHash: hashDoc(doc),
    vector,
    goal,
    doc,
  };
}

/**
 * Bring the index in line with what the harnesses currently enumerate: index
 * what is new or changed, drop what is gone, and leave everything else alone.
 * Work is batched and awaited between batches so the backend event loop stays
 * free — the wall's own scan already caps itself for the same reason.
 */
export async function runSessionIndex(deps: SessionIndexerDeps): Promise<void> {
  const { index, embed, list, save, onProgress } = deps;
  const now = deps.now ?? Date.now;
  const sessions = await list();

  const live = new Set(sessions.map((s) => s.sessionId));
  for (const id of index.ids()) {
    if (!live.has(id)) index.remove(id);
  }

  const stale = sessions.filter((s) => !index.isCurrent(s.sessionId, s.mtimeMs));
  const total = sessions.length;
  let done = total - stale.length;
  onProgress?.(done, total);

  let lastSave = now();
  for (let i = 0; i < stale.length; i += EMBED_BATCH) {
    const batch = stale.slice(i, i + EMBED_BATCH);
    const prepared: Array<{
      session: IndexableSession;
      projectPath: string;
      doc: string;
      goal: string;
    }> = [];

    await forEachConcurrent(batch, PARSE_CONCURRENCY, async (session) => {
      let entries: TurnEntry[];
      let parsed: ParsedTranscript;
      try {
        parsed = await session.parse();
        entries = (await session.loadEntries()) as TurnEntry[];
      } catch {
        return; // unreadable transcript → not indexable, and not fatal
      }
      // The same two rules the wall applies: a session with no working directory
      // cannot be placed, and a non-interactive one is an SDK or subagent run
      // nobody can open.
      if (!parsed.cwd || !parsed.interactive) return;
      const goal = sessionGoal(entries) || parsed.goal || parsed.lastPrompt;
      const doc = buildSessionDoc({
        projectPath: parsed.cwd,
        goal,
        prose: recentAssistantProse(entries, PROSE_SEGMENTS),
        targets: toolTargets(entries),
        ...(parsed.gitBranch !== undefined ? { gitBranch: parsed.gitBranch } : {}),
      });
      if (!doc) return;
      prepared.push({ session, projectPath: parsed.cwd, doc, goal });
    });

    // A transcript can be touched without its indexed head/tail changing — a
    // resumed session that only appended past the bounded read, say. Those keep
    // their vector and only take the new mtime, which is what the stored content
    // hash is for.
    const fresh: typeof prepared = [];
    for (const p of prepared) {
      const existing = index.get(p.session.sessionId);
      if (existing && existing.docHash === hashDoc(p.doc)) {
        index.upsert({ ...existing, mtimeMs: p.session.mtimeMs });
      } else {
        fresh.push(p);
      }
    }
    if (fresh.length > 0) {
      const vectors = await embed(fresh.map((p) => p.doc));
      for (const [j, p] of fresh.entries()) {
        index.upsert(toRecord(p.session, p.projectPath, vectors[j]!, p.doc, p.goal));
      }
    }

    done += batch.length;
    onProgress?.(Math.min(done, total), total);
    if (now() - lastSave >= SAVE_INTERVAL_MS) {
      await save(index);
      lastSave = now();
    }
  }

  await save(index);
  onProgress?.(total, total);
}
