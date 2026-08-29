import { normalizeProjectPath } from "./project-switch-targets.js";

/** `localStorage` key holding the project a switch is on its way to. */
export const LANDING_INTENT_KEY = "spexr.project.landingIntent";

/**
 * The `Storage` surface this module uses; `window.localStorage` satisfies it.
 *
 * Structural so the logic can be unit-tested with a plain object — vitest runs
 * without a DOM here.
 */
export interface IntentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Record that the window is reloading on its way to `projectPath`.
 *
 * Switching project is a full window reload (`workspace.preserveWindow` is true,
 * so Theia sets the URL fragment and reloads), which drops every bit of in-memory
 * state. `localStorage` is the only channel the intent can cross.
 */
export function rememberProjectLanding(storage: IntentStorage, projectPath: string): void {
  try {
    storage.setItem(LANDING_INTENT_KEY, normalizeProjectPath(projectPath));
  } catch {
    // Storage unavailable (private mode, quota): the switch still works, the
    // landing tab is just whatever the restored layout selects.
  }
}

/**
 * Read and clear the landing intent, reporting whether this launch is the tail
 * of a project switch.
 *
 * Always one-shot, and honoured only when the loaded root is the one the switch
 * aimed at — a stale intent (a switch that failed, or a workspace the user then
 * opened by other means) must not hijack a later launch.
 *
 * @param currentPath The workspace root this launch actually loaded.
 */
export function consumeProjectLanding(storage: IntentStorage, currentPath?: string): boolean {
  let stored: string | null = null;
  try {
    stored = storage.getItem(LANDING_INTENT_KEY);
    storage.removeItem(LANDING_INTENT_KEY);
  } catch {
    return false;
  }
  if (!stored || !currentPath) return false;
  return stored === normalizeProjectPath(currentPath);
}
