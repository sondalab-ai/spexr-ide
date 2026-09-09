const K1 = 1.5;  // term saturation; higher = more weight on rare terms
const B  = 0.3;  // length normalization; lower suits code (files vary wildly in size)

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "it", "in", "on", "at", "to", "of", "and", "or",
  "for", "with", "from", "import", "export", "return", "const", "let", "var",
  "new", "this", "true", "false", "null", "undefined", "void", "any", "as",
]);

/** Tokenize text: split on non-word chars + camelCase, lowercase, drop stop words. */
export function bm25Tokenize(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.split(/[^a-zA-Z0-9]+/)) {
    if (!word || word.length < 2) continue;
    for (const part of word.split(/(?=[A-Z])/)) {
      const t = part.toLowerCase();
      if (t.length >= 2 && !STOP_WORDS.has(t)) tokens.push(t);
    }
  }
  return tokens;
}

interface Serialized {
  df: Record<string, number>;
  tf: Record<string, Record<string, number>>;
  lengths: Record<string, number>;
  avgLength: number;
}

/** In-memory BM25 index with incremental upsert/remove and JSON persistence. */
export class BM25Index {
  private df = new Map<string, number>();
  private tf = new Map<string, Map<string, number>>();
  private lengths = new Map<string, number>();
  private avgLength = 0;

  get size(): number { return this.tf.size; }

  upsert(path: string, text: string): void {
    this.remove(path);
    const tokens = bm25Tokenize(text);
    const freq = new Map<string, number>();
    for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
    this.tf.set(path, freq);
    this.lengths.set(path, tokens.length);
    for (const term of freq.keys()) this.df.set(term, (this.df.get(term) ?? 0) + 1);
    this._recomputeAvg();
  }

  remove(path: string): void {
    const old = this.tf.get(path);
    if (!old) return;
    for (const term of old.keys()) {
      const d = (this.df.get(term) ?? 1) - 1;
      if (d <= 0) this.df.delete(term); else this.df.set(term, d);
    }
    this.tf.delete(path);
    this.lengths.delete(path);
    this._recomputeAvg();
  }

  private _recomputeAvg(): void {
    const vals = [...this.lengths.values()];
    this.avgLength = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 1;
  }

  /**
   * Score each path in `candidates` against the query.
   * Omit `candidates` to score all indexed documents (fast — pure arithmetic).
   */
  score(queryText: string, candidates?: string[]): Map<string, number> {
    const qTokens = bm25Tokenize(queryText);
    const N = this.tf.size || 1;
    const paths = candidates ?? [...this.tf.keys()];
    const out = new Map<string, number>();

    for (const path of paths) {
      const docFreq = this.tf.get(path);
      if (!docFreq) { out.set(path, 0); continue; }
      const dl = this.lengths.get(path) ?? 1;
      let s = 0;
      for (const term of qTokens) {
        s += this._termScore(term, docFreq, dl, N);
      }
      out.set(path, s);
    }
    return out;
  }

  /**
   * What one term contributes to one document's score. Shared with {@link explain}
   * so the reported terms are ranked by the same arithmetic that ranked the
   * document, rather than by a second formula that could drift from it.
   */
  private _termScore(term: string, docFreq: Map<string, number>, dl: number, N: number): number {
    const df = this.df.get(term) ?? 0;
    if (df === 0) return 0;
    const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
    const tf  = docFreq.get(term) ?? 0;
    return idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (dl / this.avgLength)));
  }

  /**
   * The query terms that actually moved this document's score, strongest first.
   *
   * Ranked by contribution rather than by the order they were typed: a rare term
   * is most of the score and a common one is nearly none of it, so contribution
   * order is what answers "why did this match". Terms the document does not
   * contain score zero and are left out. `limit` keeps the caller from rendering
   * every word of a long query.
   */
  explain(path: string, queryText: string, limit = 4): string[] {
    const docFreq = this.tf.get(path);
    if (!docFreq) return [];
    const dl = this.lengths.get(path) ?? 1;
    const N = this.tf.size || 1;
    const scored: { term: string; weight: number }[] = [];
    for (const term of new Set(bm25Tokenize(queryText))) {
      const weight = this._termScore(term, docFreq, dl, N);
      if (weight > 0) scored.push({ term, weight });
    }
    scored.sort((a, b) => b.weight - a.weight);
    return scored.slice(0, limit).map((t) => t.term);
  }

  toJSON(): Serialized {
    return {
      df:      Object.fromEntries(this.df),
      tf:      Object.fromEntries([...this.tf].map(([p, m]) => [p, Object.fromEntries(m)])),
      lengths: Object.fromEntries(this.lengths),
      avgLength: this.avgLength,
    };
  }

  static fromJSON(data: unknown): BM25Index {
    const idx = new BM25Index();
    if (!data || typeof data !== "object") return idx;
    const d = data as Serialized;
    idx.df = new Map(Object.entries(d.df ?? {}));
    idx.lengths = new Map(
      Object.entries(d.lengths ?? {}).map(([k, v]) => [k, Number(v)])
    );
    idx.avgLength = d.avgLength ?? 1;
    for (const [path, terms] of Object.entries(d.tf ?? {})) {
      idx.tf.set(path, new Map(Object.entries(terms as Record<string, number>)));
    }
    return idx;
  }
}
