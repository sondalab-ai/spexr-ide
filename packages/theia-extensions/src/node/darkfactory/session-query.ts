import type { SessionIndex } from "./session-index.js";

/** Hits returned per query. */
export const TOP_K = 24;
/** Blend weights: the same split the code search uses. */
const DENSE_WEIGHT = 0.65;
const BM25_WEIGHT = 0.35;
/** Dense floor for candidate gathering — deliberately low, to widen the pool. */
const DENSE_CANDIDATE_THRESHOLD = 0.05;
/** A lexical score this close to the best one earns a place among the candidates. */
const BM25_CANDIDATE_RATIO = 0.3;
/** Final cut: below this a hit is noise rather than a match. */
const MIN_SCORE = 0.18;

export interface RankedSession {
  sessionId: string;
  score: number;
}

/**
 * Blend the dense and lexical passes into one ranking. The dense pass finds
 * paraphrase, the lexical pass finds the literal terms — file names, project
 * names, and the non-English words the English-only encoder cannot place.
 */
export function rankSessions(
  index: SessionIndex,
  queryVector: Float32Array,
  expandedQuery: string,
): RankedSession[] {
  const dense = index.searchDense(queryVector, TOP_K * 3, DENSE_CANDIDATE_THRESHOLD);
  const denseScores = new Map(dense.map((h) => [h.sessionId, h.score]));

  const lexical = index.bm25.score(expandedQuery);
  const maxLexical = Math.max(...lexical.values(), 0.001);

  const candidates = new Set(denseScores.keys());
  for (const [sessionId, score] of lexical) {
    if (score / maxLexical >= BM25_CANDIDATE_RATIO) candidates.add(sessionId);
  }

  const ranked: RankedSession[] = [];
  for (const sessionId of candidates) {
    const cosine = denseScores.get(sessionId) ?? 0;
    const bm25 = (lexical.get(sessionId) ?? 0) / maxLexical;
    const score = DENSE_WEIGHT * cosine + BM25_WEIGHT * bm25;
    if (score >= MIN_SCORE) ranked.push({ sessionId, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, TOP_K);
}
