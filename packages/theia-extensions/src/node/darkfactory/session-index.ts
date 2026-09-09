import { BM25Index } from "../search/bm25-index.js";
import { cosineSimilarity, topKIndices } from "../search/vector-math.js";
import type { HarnessId } from "../../common/harness/harness-types.js";

/**
 * Deliberately independent of the code index's `INDEX_VERSION`: the two indexes
 * hold different things in different places, and sharing a version would force a
 * full code reindex on every session-index change.
 */
export const SESSION_INDEX_VERSION = 1;

/** One indexed session: what it takes to score it, render it, and open it. */
export interface SessionRecord {
  sessionId: string;
  harness: HarnessId;
  projectPath: string;
  projectName: string;
  /** Claude only; empty for opencode, whose transcript comes from the CLI. */
  transcriptPath: string;
  /** Claude config dir owning the session; empty for opencode. */
  configDir: string;
  mtimeMs: number;
  docHash: string;
  vector: Float32Array;
  goal: string;
  /**
   * The session's own text. The name the user gave it is kept apart, in
   * `customName`, so a later rename replaces it instead of layering on top —
   * {@link indexedText} is what actually gets scored.
   */
  doc: string;
  /** The name the user gave the session, if any. Leads the indexed text. */
  customName?: string;
}

/**
 * What the index scores: the user's own name for the session first, because it
 * is the wording they will search with, then the session's text.
 */
export function indexedText(record: Pick<SessionRecord, "doc" | "customName">): string {
  const name = record.customName?.trim();
  return name ? `${name}\n${record.doc}` : record.doc;
}

/** One dense-pass result, before the lexical half is blended in. */
export interface SessionVectorHit {
  sessionId: string;
  score: number;
}

interface SerializedSessionRecord extends Omit<SessionRecord, "vector"> {
  vector: number[];
}

export interface SerializedSessionIndex {
  version: number;
  records: SerializedSessionRecord[];
}

/**
 * The session store: one vector and one BM25 document per session, kept in step
 * so a session is either in both halves of the hybrid score or in neither.
 */
export class SessionIndex {
  private readonly records = new Map<string, SessionRecord>();
  readonly bm25 = new BM25Index();

  get size(): number {
    return this.records.size;
  }

  upsert(record: SessionRecord): void {
    this.records.set(record.sessionId, record);
    this.bm25.upsert(record.sessionId, indexedText(record));
  }

  remove(sessionId: string): boolean {
    this.bm25.remove(sessionId);
    return this.records.delete(sessionId);
  }

  /** True when the stored record already reflects this session's mtime. */
  isCurrent(sessionId: string, mtimeMs: number): boolean {
    return this.records.get(sessionId)?.mtimeMs === mtimeMs;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.records.get(sessionId);
  }

  ids(): string[] {
    return [...this.records.keys()];
  }

  searchDense(queryVector: Float32Array, k: number, minScore: number): SessionVectorHit[] {
    const records = [...this.records.values()];
    const scores = records.map((r) => cosineSimilarity(queryVector, r.vector));
    return topKIndices(scores, k, minScore).map((i) => ({
      sessionId: records[i]!.sessionId,
      score: scores[i]!,
    }));
  }

  toJSON(): SerializedSessionIndex {
    return {
      version: SESSION_INDEX_VERSION,
      records: [...this.records.values()].map((r) => ({ ...r, vector: Array.from(r.vector) })),
    };
  }

  /**
   * Rebuild from serialized data; an unknown version or a malformed payload
   * yields an empty index, which the crawl then refills. The BM25 store is
   * rebuilt from each record's document rather than serialized separately, so
   * the two halves cannot drift apart on disk.
   */
  static fromJSON(data: unknown): SessionIndex {
    const index = new SessionIndex();
    const doc = data as SerializedSessionIndex | null;
    if (!doc || typeof doc !== "object") return index;
    if (doc.version !== SESSION_INDEX_VERSION || !Array.isArray(doc.records)) return index;
    for (const r of doc.records) {
      index.upsert({ ...r, vector: new Float32Array(r.vector) });
    }
    return index;
  }
}
