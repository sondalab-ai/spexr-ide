import type { ClaudeConfigDir } from "../../common/darkfactory-protocol.js";

/** Storage key for the Claude account the launcher last started a session under. */
export const NEW_SESSION_CONFIG_KEY = "spexr.darkfactory.newSessionConfigDir";

/** The slice of `localStorage` this module needs, so tests can pass a fake. */
export interface ChoiceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Which account the launcher pre-selects: the last one the user started under,
 * as long as it is still discovered — an account that has gone away must not
 * silently send the session to a config dir that no longer exists. Otherwise the
 * default one, which the backend already puts first.
 */
export function pickConfigDir(stored: string | null, available: readonly ClaudeConfigDir[]): string {
  if (stored && available.some((c) => c.path === stored)) return stored;
  return (available.find((c) => c.isDefault) ?? available[0])?.path ?? "";
}

/** The stored choice, validated against what is currently discovered. */
export function readConfigDirChoice(
  storage: ChoiceStorage,
  available: readonly ClaudeConfigDir[],
): string {
  let raw: string | null;
  try {
    raw = storage.getItem(NEW_SESSION_CONFIG_KEY);
  } catch {
    return pickConfigDir(null, available); // private windows and blocked site data throw
  }
  return pickConfigDir(raw, available);
}

/** Persist a choice. Storage failures are ignored: the session still starts. */
export function writeConfigDirChoice(storage: ChoiceStorage, path: string): void {
  try {
    storage.setItem(NEW_SESSION_CONFIG_KEY, path);
  } catch {
    // ignore
  }
}
