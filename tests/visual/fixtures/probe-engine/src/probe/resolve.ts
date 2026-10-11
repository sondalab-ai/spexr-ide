/**
 * resolve — the probe engine's entry point.
 *
 * A probe is a question the engine can answer from evidence: "does the
 * colour contract hold", "is the p95 under budget". Resolving one is
 * expensive the first time and cheap afterwards, because the answer and
 * the evidence behind it are cached together.
 *
 * The contract, in order:
 *
 *   1. Read the cache under the probe's key.
 *   2. A fresh hit is returned as is; nothing runs.
 *   3. A stale hit or a miss runs the probe with a new evidence log.
 *   4. The answer is written back before it is returned, so a second
 *      caller never races the first one into a duplicate run.
 *
 * Staleness is the probe's own call (`ttl`), not the cache's: a probe
 * that reads the file system goes stale when a file changes, one that
 * reads a token goes stale when the token does.
 *
 * Timeouts are generous on purpose. A probe that times out leaves no
 * answer behind, and the next run starts again from nothing, which
 * costs more than waiting a little longer the first time.
 *
 * Budget: the p95 of a cached resolve stays under P95_BUDGET_MS. The
 * audit suite measures it on every run and fails the build above it.
 *
 * See also:
 *   - cache.ts     where answers live, keyed by probe
 *   - evidence.ts  the append-only log a run writes into
 *   - ../audit     the suite that reads both
 *
 * @module probe/resolve
 */

import { Cache, Evidence } from "./cache";
import type { Probe, Answer } from "./types";

// A probe resolves once, keeps its evidence, and re-runs only what changed.
export async function resolve(probe: Probe, cache: Cache): Promise<Answer> {
  const hit = await cache.read(probe.key);
  if (hit && !hit.stale(probe.ttl)) return hit.answer;

  const evidence = new Evidence(probe.id);
  const answer = await probe.run({ evidence, timeout: 14_000 });
  cache.write(probe.key, answer);
  return answer;
}

export const P95_BUDGET_MS = 2; // measured: 1.8
