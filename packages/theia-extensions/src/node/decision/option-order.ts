/**
 * Kev's choice head favours options by their position: listing the same three
 * experts in another order turned a 0.84 "review" into a 0.78 "software
 * engineering". Asking with a few rotations of the options and averaging the
 * probabilities removes that bias; on the spec 0017 evaluation set it also
 * raised kev-4b from 83% to 85% (Italian 88% → 94%) with the same calibration.
 */

/** How many orderings a choice question is asked in. */
export const CHOICE_ROTATIONS = 3;

/**
 * Up to `count` rotations of `options`, spread evenly so a different option
 * leads each time; fewer for a list too short to have that many distinct ones.
 */
export function rotations<T>(options: readonly T[], count: number): T[][] {
  const n = options.length;
  const k = Math.min(count, n);
  if (k <= 1) return [[...options]];
  const step = Math.ceil(n / k);
  const out: T[][] = [];
  for (let r = 0; r < k; r++) {
    const shift = (r * step) % n;
    const order = options.map((_, i) => options[(i + shift) % n]!);
    if (!out.some((o) => o.every((x, i) => x === order[i]))) out.push(order);
  }
  return out;
}

/** The average of per-ordering distributions, with the most probable option as the choice. */
export function averageChoices(
  options: readonly string[],
  distributions: readonly Readonly<Record<string, number>>[],
): { choice: string; confidence: number; probabilities: Record<string, number> } {
  const probabilities: Record<string, number> = {};
  for (const o of options) {
    probabilities[o] = distributions.reduce((sum, d) => sum + (d[o] ?? 0), 0) / distributions.length;
  }
  const choice = options.reduce((best, o) => (probabilities[o]! > probabilities[best]! ? o : best), options[0]!);
  return { choice, confidence: probabilities[choice]!, probabilities };
}
