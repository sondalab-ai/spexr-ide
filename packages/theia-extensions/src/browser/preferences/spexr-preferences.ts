import { injectable } from "@theia/core/shared/inversify";
import type { PreferenceContribution, PreferenceSchema } from "@theia/core/lib/common/preferences/preference-schema";
import {
  DEFAULT_GENERATION_MODEL,
  GENERATION_DTYPES,
} from "../../common/generation-model.js";
import {
  SPEXR_TERMINAL_KINDS,
  CURSOR_STYLES,
  terminalStyleKey,
  type SpexrTerminalKind,
} from "../terminal/terminal-style.js";

/**
 * Key for the Claude Code executable path preference.
 *
 * Leave empty to let the backend auto-detect `claude` from PATH. Set an
 * absolute path to override auto-detection (e.g. when multiple Claude Code
 * installations coexist or the binary is not on PATH).
 */
export const SPEXR_CLAUDE_EXECUTABLE_PREFERENCE = "spexr.claude.executablePath";

/**
 * Key for the account SPEXR starts Claude under.
 *
 * Holds the `label` of an entry in {@link SPEXR_CLAUDE_LAUNCH_PROFILES_PREFERENCE},
 * or `"default"` for the account that runs with no `CLAUDE_CONFIG_DIR` at all.
 * Empty means the user has not chosen yet: with a single account SPEXR uses it,
 * with several it asks once and writes the answer here.
 *
 * Folder-scoped, like the active expert, and read against the first workspace
 * root: which identity to run under is a property of the project rather than of
 * the machine, but the side agent is one terminal per window — so a multi-root
 * workspace has one account, the first root's.
 */
export const SPEXR_CLAUDE_ACTIVE_PROFILE_PREFERENCE = "spexr.claude.activeProfile";

/**
 * Key for the Claude launch profiles preference.
 *
 * Each profile binds a command to the config dir it starts Claude under, so a
 * shell alias (`cld-perso`) can be used where a path preference cannot reach.
 * See `common/claude-launch-profiles.ts`.
 */
export const SPEXR_CLAUDE_LAUNCH_PROFILES_PREFERENCE = "spexr.claude.launchProfiles";

/**
 * Key recording that launch profiles were detected once at startup.
 *
 * Detection runs a single time so profiles the user deleted do not reappear on
 * the next launch; `Spexr: Detect Claude launch profiles` re-runs it on demand.
 */
export const SPEXR_CLAUDE_LAUNCH_PROFILES_DETECTED_PREFERENCE =
  "spexr.claude.launchProfilesDetected";

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

/**
 * Hugging Face repo id of the ONNX model used for local descriptions and
 * summaries. Empty means the vendored default. Machine-scoped, not project:
 * it is about what is on disk and what the machine can run.
 */
export const SPEXR_SEARCH_GEN_MODEL_PREFERENCE = "spexr.search.generationModel";

/** Quantisation the generation model is loaded at. See the model's `onnx/` files. */
export const SPEXR_SEARCH_GEN_DTYPE_PREFERENCE = "spexr.search.generationModelDtype";

/**
 * Whether the IDE fetches from the remote on its own.
 *
 * On by default, because `behind` is only truthful if something keeps it that
 * way. Off is for a metered connection, or a network where an unattended
 * authentication attempt is unwelcome.
 */
export const SPEXR_GIT_AUTOFETCH_PREFERENCE = "spexr.git.autofetch";

/** What each terminal family is, in the words a preference description needs. */
const TERMINAL_KIND_LABELS: Record<SpexrTerminalKind, string> = {
  session: "the Darkfactory session cards",
  agent: "the side agent panel",
  editor: "ordinary Theia terminals",
};

/**
 * Style preferences for the three terminal families. Every field is opt-in:
 * empty (or 0) means the terminal keeps whatever `terminal.integrated.*` and the
 * colour theme already give it, so an untouched install looks exactly as before.
 */
function terminalStyleProperties(): PreferenceSchema["properties"] {
  const properties: PreferenceSchema["properties"] = {};
  for (const kind of SPEXR_TERMINAL_KINDS) {
    const where = TERMINAL_KIND_LABELS[kind];
    properties[terminalStyleKey(kind, "fontFamily")] = {
      type: "string",
      default: "",
      description: `Font family for ${where}. Empty inherits terminal.integrated.fontFamily.`,
    };
    properties[terminalStyleKey(kind, "fontSize")] = {
      type: "number",
      default: 0,
      description: `Font size, in pixels, for ${where}. 0 inherits terminal.integrated.fontSize.`,
    };
    properties[terminalStyleKey(kind, "lineHeight")] = {
      type: "number",
      default: 0,
      description: `Line height, as a multiple of the font size, for ${where}. 0 inherits.`,
    };
    properties[terminalStyleKey(kind, "letterSpacing")] = {
      type: "number",
      default: 0,
      description: `Extra letter spacing, in pixels, for ${where}. 0 inherits, which is also xterm's own default.`,
    };
    properties[terminalStyleKey(kind, "cursorStyle")] = {
      type: "string",
      enum: ["", ...CURSOR_STYLES],
      default: "",
      description: `Cursor shape for ${where}. Empty inherits terminal.integrated.cursorStyle.`,
    };
    properties[terminalStyleKey(kind, "cursorBlink")] = {
      type: "string",
      enum: ["", "on", "off"],
      default: "",
      description: `Whether the cursor blinks in ${where}. Empty inherits terminal.integrated.cursorBlinking.`,
    };
    properties[terminalStyleKey(kind, "background")] = {
      type: "string",
      default: "",
      description: `Background colour for ${where}, as CSS hex. Empty inherits the colour theme's terminal.background.`,
    };
    properties[terminalStyleKey(kind, "foreground")] = {
      type: "string",
      default: "",
      description: `Text colour for ${where}, as CSS hex. Empty inherits the colour theme's terminal.foreground. The 16 ANSI colours always come from the theme.`,
    };
  }
  return properties;
}

const SpexrPreferencesSchema: PreferenceSchema = {
  properties: {
    [SPEXR_CLAUDE_EXECUTABLE_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "Path override for the Claude Code CLI binary used by the SPEXR agent, " +
        "e.g. /usr/local/bin/claude or ~/.local/bin/claude. Leave empty to " +
        "auto-detect from PATH. For a shell alias use spexr.claude.launchProfiles " +
        "instead: an alias names no file. Folder-scoped.",
    },
    [SPEXR_CLAUDE_ACTIVE_PROFILE_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "Account SPEXR starts Claude under: the label of a spexr.claude.launchProfiles " +
        "entry, or \"default\" for the account that runs with no CLAUDE_CONFIG_DIR. " +
        "Empty means not chosen yet — SPEXR asks once when the machine has more " +
        "than one account. Read against the first workspace root, so separate " +
        "workspaces (personal, work) can run under different identities while " +
        "the folders of one multi-root workspace share the side agent's account. " +
        "Change it with `Spexr: Select Claude account`.",
    },
    [SPEXR_CLAUDE_LAUNCH_PROFILES_PREFERENCE]: {
      type: "array",
      default: [],
      description:
        "How to start Claude per account. Each profile names a command — a shell " +
        "alias, a binary name, or a path — and the CLAUDE_CONFIG_DIR it belongs to, " +
        "so resuming a session uses the command that owns it. Written at user level " +
        "by `Spexr: Detect Claude launch profiles`; can be overridden per folder.",
      // The settings UI sends an array of objects to settings.json rather than
      // rendering inputs, so a worked example has to travel with the schema:
      // these are what the JSON editor offers on completion.
      defaultSnippets: [
        {
          label: "Wrapper alias (sets its own account)",
          description:
            "A shell alias such as alias cld-perso='CLAUDE_CONFIG_DIR=~/.claude-perso cld'",
          body: {
            label: "Perso",
            command: "cld-perso",
            configDir: "~/.claude-perso",
            ownsConfigDir: true,
          },
        },
        {
          label: "Wrapper command for an account",
          description: "A binary or script that does not set CLAUDE_CONFIG_DIR itself",
          body: { label: "Work", command: "cld", configDir: "~/.claude" },
        },
      ],
      items: {
        type: "object",
        required: ["command", "configDir"],
        defaultSnippets: [
          {
            label: "Launch profile",
            body: { label: "", command: "", configDir: "~/.claude", ownsConfigDir: false },
          },
        ],
        properties: {
          label: {
            type: "string",
            description: "Name shown in the session launcher. Defaults to the command.",
          },
          command: {
            type: "string",
            description:
              "Command to run: a single word (alias, binary name or path), " +
              "e.g. cld-perso, claude or /usr/local/bin/claude. " +
              "Arguments, spaces and shell syntax are rejected.",
          },
          configDir: {
            type: "string",
            description: "Config dir this command starts Claude under, e.g. ~/.claude-perso.",
          },
          ownsConfigDir: {
            type: "boolean",
            default: false,
            description:
              "True when the command sets CLAUDE_CONFIG_DIR itself (as an alias does). " +
              "SPEXR then leaves the variable to the command instead of exporting it.",
          },
        },
      },
    },
    [SPEXR_CLAUDE_LAUNCH_PROFILES_DETECTED_PREFERENCE]: {
      type: "boolean",
      default: false,
      // Bookkeeping, not a setting: shown in settings.json but not in the UI.
      hidden: true,
      description:
        "Whether SPEXR has already looked for Claude launch aliases in your shell " +
        "configuration. Set false to have it look again on the next start.",
    },
    [SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "ID of the active expert persona for this workspace. Empty means no expert " +
        "(base prompt). Set when launching an expert session. Folder-scoped.",
    },
    [SPEXR_GIT_AUTOFETCH_PREFERENCE]: {
      type: "boolean",
      default: true,
      description:
        "Fetch from the remote every few minutes, and when the window regains focus, " +
        "so the branch's ahead/behind counts stay truthful. Never touches the working " +
        "tree and never prompts for credentials. Turn off on a metered connection, or " +
        "where an unattended authentication attempt is unwelcome.",
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
    [SPEXR_SEARCH_GEN_MODEL_PREFERENCE]: {
      type: "string",
      default: "",
      description:
        "Hugging Face repo id of the ONNX text-generation model used for local file " +
        `descriptions and session summaries. Empty uses the built-in ${DEFAULT_GENERATION_MODEL.id}. ` +
        "The model must already sit in the app's models directory — fetch it first with " +
        "`SPEXR_GEN_MODEL=<id> pnpm fetch-model`, since the runtime never downloads at " +
        "startup. Applies to descriptions only: the embedding model is fixed. User-scoped.",
    },
    [SPEXR_SEARCH_GEN_DTYPE_PREFERENCE]: {
      type: "string",
      enum: [...GENERATION_DTYPES],
      default: DEFAULT_GENERATION_MODEL.dtype,
      description:
        "Quantisation the generation model is loaded at. Must match a file the model " +
        "publishes under `onnx/` (e.g. `model_q4.onnx` for q4). User-scoped.",
    },
    ...terminalStyleProperties(),
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
