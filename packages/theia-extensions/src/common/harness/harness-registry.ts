import type { HarnessAdapter, HarnessId } from "./harness-types.js";

/** Predicate deciding whether a harness is installed on this machine. */
export type DetectFn = (adapter: HarnessAdapter) => boolean;

/** The subset of `adapters` reported installed by `detect`, order preserved. */
export function installedHarnesses(adapters: HarnessAdapter[], detect: DetectFn): HarnessAdapter[] {
  return adapters.filter((a) => detect(a));
}

/**
 * Resolve the active harness: none installed → undefined; exactly one → that one
 * (preference ignored); several → the preferred one when installed, else the
 * first installed.
 */
export function resolveActiveHarness(
  adapters: HarnessAdapter[],
  detect: DetectFn,
  preferred?: HarnessId,
): HarnessAdapter | undefined {
  const installed = installedHarnesses(adapters, detect);
  if (installed.length === 0) return undefined;
  if (installed.length === 1) return installed[0];
  return installed.find((a) => a.id === preferred) ?? installed[0];
}
