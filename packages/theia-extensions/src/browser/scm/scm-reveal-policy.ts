// Pure reveal policy, free of Theia imports so it can be unit-tested without the
// browser DI runtime (importing the contribution pulls in Lumino, which touches
// `document` at import time).

/**
 * Repository count from which the "Repositories" section earns its space. Below
 * it the section would list a single entry the SCM panel already shows in its
 * own header, so Theia hides it — and this reveal must not override that.
 */
export const REVEAL_THRESHOLD = 2;

/** Whether the SCM panel's "Repositories" section should be shown. */
export function shouldReveal(repositoryCount: number): boolean {
  return repositoryCount >= REVEAL_THRESHOLD;
}

/**
 * Share of the SCM view container the "Repositories" section gets when this
 * reveal is the thing that shows it. Revealed with no size of its own the
 * section takes the average weight, which against a single "Changes" section is
 * half the panel — far more than a list of repository names needs, and it is
 * the changes below that the user actually works in.
 */
export const REPOSITORIES_SHARE = 0.25;

/**
 * Weights for `ViewContainerLayout.setPartSizes`, giving the part at `index`
 * {@link REPOSITORIES_SHARE} of the container and splitting the rest evenly.
 *
 * `sizeable[i]` is whether part `i` takes part in the split at all — a hidden or
 * collapsed part does not, and gets `undefined` so the layout keeps ignoring it.
 * The result is all-`undefined` when there is nothing to size (an out-of-range
 * index, or fewer than two participating parts); callers should skip the layout
 * call in that case rather than ask it to redistribute nothing.
 */
export function repositoriesWeights(
  sizeable: readonly boolean[],
  index: number,
  share: number = REPOSITORIES_SHARE,
): (number | undefined)[] {
  const none = sizeable.map(() => undefined);
  const counted = sizeable.filter(Boolean).length;
  if (index < 0 || index >= sizeable.length || !sizeable[index] || counted < 2) return none;
  const others = (1 - share) / (counted - 1);
  return sizeable.map((counts, i) => (!counts ? undefined : i === index ? share : others));
}
