import type { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import {
  profilesFromScopes,
  type ClaudeLaunchProfile,
} from "../../common/claude-launch-profiles.js";
import { SPEXR_CLAUDE_LAUNCH_PROFILES_PREFERENCE } from "./spexr-preferences.js";

/**
 * The launch profiles in force for a resource.
 *
 * Reads every scope rather than the merged value, because Theia replaces a
 * top-level array instead of merging it: an empty one written at an outer scope
 * would otherwise erase the accounts configured further in. See
 * {@link profilesFromScopes} for the precedence this applies.
 *
 * @param preferences  Frontend preference service.
 * @param resource     Folder the profiles are read against; without one, folder
 *                     scope contributes nothing (Theia skips it).
 */
export function readLaunchProfiles(
  preferences: PreferenceService,
  resource?: string,
): ClaudeLaunchProfile[] {
  const found = preferences.inspect<never>(SPEXR_CLAUDE_LAUNCH_PROFILES_PREFERENCE, resource);
  if (!found) return [];
  return profilesFromScopes({
    session: found.sessionValue,
    folder: found.workspaceFolderValue,
    workspace: found.workspaceValue,
    user: found.globalValue,
    fallback: found.defaultValue,
  });
}
