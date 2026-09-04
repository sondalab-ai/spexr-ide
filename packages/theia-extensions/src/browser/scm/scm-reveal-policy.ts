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
