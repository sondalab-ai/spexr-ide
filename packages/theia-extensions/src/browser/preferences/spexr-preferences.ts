import { injectable } from "@theia/core/shared/inversify";
import type { PreferenceContribution, PreferenceSchema } from "@theia/core/lib/common/preferences/preference-schema";

/**
 * Key for the Claude Code executable path preference.
 *
 * Leave empty to let the backend auto-detect `claude` from PATH. Set an
 * absolute path to override auto-detection (e.g. when multiple Claude Code
 * installations coexist or the binary is not on PATH).
 */
export const SPEXR_CLAUDE_EXECUTABLE_PREFERENCE = "spexr.claude.executablePath";

/**
 * Key for the `CLAUDE_CONFIG_DIR` override preference.
 *
 * When set, the spawned CLI uses this directory for authentication instead of
 * the default `~/.claude`. Populated automatically by the profile quick-pick.
 */
export const SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE = "spexr.claude.configDir";

/**
 * Key for the selected Claude profile identifier preference.
 *
 * Persisted per-folder once the user makes a choice in the quick-pick so the
 * prompt does not appear again for the same workspace. Empty string means
 * the user has not yet chosen.
 */
export const SPEXR_CLAUDE_PROFILE_ID_PREFERENCE = "spexr.claude.profileId";

/**
 * Key for the active expert persona id for this workspace.
 *
 * Folder-scoped. Empty string means no expert is active (base prompt).
 */
export const SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE = "spexr.experts.activeId";

/**
 * Toggle for locally-generated AI file descriptions in search results.
 * On by default. Off shows heuristic descriptions only and skips the local model.
 */
export const SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE = "spexr.search.aiDescriptions.enabled";

/**
 * Whether we have already asked the user about adding `.spexr/` to their global git
 * ignore. Set once (either answer) so the one-time consent prompt never repeats.
 */
export const SPEXR_SEARCH_GLOBAL_IGNORE_PROMPTED = "spexr.search.globalIgnore.prompted";

const SpexrPreferencesSchema: PreferenceSchema = {
  properties: {
    [SPEXR_CLAUDE_EXECUTABLE_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "Path override for the Claude Code CLI binary used by the SPEXR agent. " +
        "Leave empty to auto-detect from PATH. Folder-scoped.",
    },
    [SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "CLAUDE_CONFIG_DIR override passed to the spawned CLI. Set automatically " +
        "when a Claude account profile is chosen. Folder-scoped.",
    },
    [SPEXR_CLAUDE_PROFILE_ID_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "ID of the Claude account profile chosen for this workspace. " +
        "Empty means not yet selected (prompt will appear on next open). Folder-scoped.",
    },
    [SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "ID of the active expert persona for this workspace. Empty means no expert " +
        "(base prompt). Set when launching an expert session. Folder-scoped.",
    },
    [SPEXR_SEARCH_GLOBAL_IGNORE_PROMPTED]: {
      type: "boolean",
      default: false,
      description:
        "Internal: set once the user has been asked whether to add `.spexr/` to their " +
        "global git ignore, so the consent prompt is shown only once.",
    },
    [SPEXR_SEARCH_AI_DESCRIPTIONS_PREFERENCE]: {
      type: "boolean",
      default: true,
      description:
        "Generate AI file descriptions locally for search results. " +
        "Turn off to skip the local model and show heuristic descriptions only.",
    },
  },
};

/**
 * Registers SPEXR-specific user preferences with the Theia preference system.
 *
 * Bind this class to both its own identifier and to `PreferenceContribution`
 * in the frontend module so the schema is picked up at startup.
 */
@injectable()
export class SpexrPreferenceContribution implements PreferenceContribution {
  readonly schema = SpexrPreferencesSchema;
}
