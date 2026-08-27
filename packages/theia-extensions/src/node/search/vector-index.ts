import { cosineSimilarity, topKIndices } from "./vector-math.js";

export const INDEX_VERSION = 8;

export interface IndexRecord {
  path: string;
  vector: Float32Array;
  mtimeMs: number;
  hash: string;
  snippet: string;
  category: string;
  description: string;
  aiDescription?: string;
}

export interface IndexHit {
  path: string;
  score: number;
  snippet: string;
  category: string;
  description: string;
}

interface SerializedRecord {
  path: string;
  vector: number[];
  mtimeMs: number;
  hash: string;
  snippet: string;
  category: string;
  description: string;
  aiDescription?: string;
}

export interface SerializedIndex {
  version: number;
  records: SerializedRecord[];
}

/** In-memory vector store with brute-force cosine search and JSON persistence. */
export class VectorIndex {
  private readonly records = new Map<string, IndexRecord>();

  get size(): number {
    return this.records.size;
  }

  upsert(record: IndexRecord): void {
    this.records.set(record.path, record);
  }

  /** Attach an AI-generated description to an existing record, if present. */
  setAiDescription(path: string, text: string): void {
    const rec = this.records.get(path);
    if (rec) rec.aiDescription = text;
  }

  /** Remove a record; returns true when one was actually present. */
  remove(path: string): boolean {
    return this.records.delete(path);
  }

  has(path: string, hash: string): boolean {
    return this.records.get(path)?.hash === hash;
  }

  getRecord(path: string): IndexRecord | undefined {
    return this.records.get(path);
  }

  /** All records, in insertion order. */
  allRecords(): IndexRecord[] {
    return [...this.records.values()];
  }

  search(queryVector: Float32Array, k: number, minScore: number): IndexHit[] {
    const records = [...this.records.values()];
    const scores = records.map((r) => cosineSimilarity(queryVector, r.vector));
    return topKIndices(scores, k, minScore).map((i) => ({
      path: records[i]!.path,
      score: scores[i]!,
      snippet: records[i]!.snippet,
      category: records[i]!.category,
      description: records[i]!.description,
    }));
  }

  /** Replace all records in this index with the records from `other`. */
  replaceWith(other: VectorIndex): void {
    this.records.clear();
    for (const [path, record] of other.records) {
      this.records.set(path, record);
    }
  }

  toJSON(): SerializedIndex {
    return {
      version: INDEX_VERSION,
      records: [...this.records.values()].map((r) => ({
        path: r.path,
        vector: Array.from(r.vector),
        mtimeMs: r.mtimeMs,
        hash: r.hash,
        snippet: r.snippet,
        category: r.category,
        description: r.description,
        ...(r.aiDescription !== undefined ? { aiDescription: r.aiDescription } : {}),
      })),
    };
  }

  /** Rebuild from serialized data; returns an empty index if version/shape is invalid. */
  static fromJSON(data: unknown): VectorIndex {
    const index = new VectorIndex();
    if (
      !data ||
      typeof data !== "object" ||
      (data as SerializedIndex).version !== INDEX_VERSION ||
      !Array.isArray((data as SerializedIndex).records)
    ) {
      return index;
    }
    for (const r of (data as SerializedIndex).records) {
      index.upsert({
        path: r.path,
        vector: new Float32Array(r.vector),
        mtimeMs: r.mtimeMs,
        hash: r.hash,
        snippet: r.snippet,
        category: r.category ?? "other",
        description: r.description ?? "",
        ...(r.aiDescription !== undefined ? { aiDescription: r.aiDescription } : {}),
      });
    }
    return index;
  }
}
