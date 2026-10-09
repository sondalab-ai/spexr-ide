/**
 * Problem marks follow `problems.decorations.enabled` (S6b, L7): the decoration
 * Theia's provider made for a file, or nothing while the preference is off.
 * Lazy, so Theia's provider is not asked when the answer is nothing.
 */
export function gateProblemDecoration<T>(enabled: boolean, provide: () => T): T | undefined {
  return enabled ? provide() : undefined;
}
