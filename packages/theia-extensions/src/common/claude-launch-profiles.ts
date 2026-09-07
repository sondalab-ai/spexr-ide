/**
 * Launch profiles: how SPEXR starts Claude for a given account.
 *
 * The `spexr.claude.executablePath` preference holds a *path*, which is enough
 * for a binary but cannot express a shell alias — and an alias is how users
 * bind a wrapper to an account (`alias cld-perso='CLAUDE_CONFIG_DIR=~/.claude-perso cld'`).
 * A profile pairs the command to run with the config dir it belongs to, so a
 * resume can find the command that owns an existing session.
 *
 * Kept node-free: the frontend resolves the command for every terminal it opens.
 */

export interface ClaudeLaunchProfile {
  /** Shown in the launcher. */
  readonly label: string;
  /** Command word: an alias, a bare binary name, or an absolute path. */
  readonly command: string;
  /** Config dir this command starts Claude under. May be `~`-relative. */
  readonly configDir: string;
  /**
   * Whether the command sets CLAUDE_CONFIG_DIR itself (an alias like
   * `CLAUDE_CONFIG_DIR=… cld` does). When true the caller must not also export
   * the variable: two sources of truth diverge silently on resume.
   */
  readonly ownsConfigDir?: boolean;
}

/**
 * A command is spliced into a shell line **unquoted**, because quoting is
 * exactly what stops zsh from expanding an alias. That makes the value an
 * injection vector, so only a single bare word is accepted: letters, digits,
 * dot, underscore, dash and slash. Spaces, `;`, `$`, quotes and backticks are
 * all rejected, which also rules out a command line with arguments.
 */
const COMMAND_RE = /^[A-Za-z0-9._/-]+$/;

export function isValidLaunchCommand(command: string): boolean {
  return COMMAND_RE.test(command);
}

/** Strip a trailing slash and surrounding blanks so paths compare by value. */
function normalizeDir(dir: string): string {
  return dir.trim().replace(/\/+$/, "");
}

/**
 * Whether two config-dir references name the same directory.
 *
 * Profiles are written by hand and usually say `~/.claude-perso`, while a
 * session carries the absolute path it was discovered at, so a `~`-relative
 * reference matches any absolute path ending in the same suffix.
 */
export function sameConfigDir(a: string, b: string): boolean {
  const [x, y] = [normalizeDir(a), normalizeDir(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  const suffixOf = (tilde: string, absolute: string): boolean =>
    tilde.startsWith("~/") && absolute.startsWith("/") && absolute.endsWith(tilde.slice(1));
  return suffixOf(x, y) || suffixOf(y, x);
}

/**
 * Read profiles out of a preference value, dropping anything malformed rather
 * than throwing: a hand-edited settings.json must not break session launching.
 */
export function parseLaunchProfiles(raw: unknown): ClaudeLaunchProfile[] {
  if (!Array.isArray(raw)) return [];
  const profiles: ClaudeLaunchProfile[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { label, command, configDir, ownsConfigDir } = entry as Record<string, unknown>;
    if (typeof command !== "string" || !isValidLaunchCommand(command.trim())) continue;
    if (typeof configDir !== "string" || !configDir.trim()) continue;
    profiles.push({
      label: typeof label === "string" && label.trim() ? label.trim() : command.trim(),
      command: command.trim(),
      configDir: configDir.trim(),
      ownsConfigDir: ownsConfigDir === true,
    });
  }
  return profiles;
}

/** The profile that owns a config dir, if one is configured for it. */
export function profileForConfigDir(
  profiles: readonly ClaudeLaunchProfile[],
  configDir: string,
): ClaudeLaunchProfile | undefined {
  if (!configDir.trim()) return undefined;
  return profiles.find((p) => sameConfigDir(p.configDir, configDir));
}

/** Where a Claude account profile with no explicit config dir points. */
export const DEFAULT_CONFIG_DIR = "~/.claude";

/** What a launch needs: the command word, and whether to export the config dir. */
export interface LaunchPlan {
  readonly command: string;
  /** Config dir to export, or "" when the command sets it itself. */
  readonly exportConfigDir: string;
  /** True when `command` is a shell word that must not be quoted. */
  readonly unquoted: boolean;
}

/**
 * The config dir to export for an account, empty when it must not be exported.
 *
 * The default account is named by *not* setting CLAUDE_CONFIG_DIR, not by
 * setting it to `~/.claude`: Claude Code keeps its OAuth token in a different
 * keychain entry depending on whether the variable is set at all, so exporting
 * the default path lands on a different identity than running `claude` by hand.
 * The account the user re-authenticates in a terminal is the unset one.
 */
function exportFor(configDir: string): string {
  return sameConfigDir(configDir, DEFAULT_CONFIG_DIR) ? "" : configDir;
}

/**
 * Decide how to launch Claude for a config dir.
 *
 * A profile wins over the executable-path preference, and a profile that sets
 * the account itself suppresses the export so the two cannot disagree. With no
 * profile the behaviour is what it was before profiles existed: the configured
 * path, or a bare `claude`. The config dir is exported unless it is the default
 * account, which is expressed by leaving the variable unset.
 */
export function resolveLaunchPlan(
  profiles: readonly ClaudeLaunchProfile[],
  configDir: string,
  executablePath: string,
): LaunchPlan {
  const profile = profileForConfigDir(profiles, configDir);
  if (profile) {
    return {
      command: profile.command,
      exportConfigDir: profile.ownsConfigDir ? "" : exportFor(configDir),
      unquoted: true,
    };
  }
  const exe = executablePath.trim();
  return { command: exe || "claude", exportConfigDir: exportFor(configDir), unquoted: !exe };
}

/**
 * Text for one account in the session launcher.
 *
 * The account is still what the user picks — the command follows from it — so
 * the command is shown as a suffix rather than replacing the directory name:
 * it is the only place that says which wrapper a session will actually start.
 */
export function launchOptionLabel(
  label: string,
  isDefault: boolean,
  profile?: ClaudeLaunchProfile,
): string {
  const account = isDefault ? `${label} (default)` : label;
  return profile ? `${account} — ${profile.command}` : account;
}

/** The parts of an account profile a launch decision depends on. */
export interface AccountProfile {
  readonly executablePath?: string;
  readonly configDir?: string;
}

/**
 * Decide how the agent terminal starts Claude for an account profile.
 *
 * Both callers now treat an empty `exportConfigDir` the same way — unset the
 * variable rather than leave it — so a stray value in the host environment
 * cannot redirect the default account, and a launch profile that owns the
 * account is left in sole charge of it. An account that names the default
 * config dir explicitly is also expressed by unsetting: see `exportFor`.
 */
export function resolveAgentLaunch(
  profiles: readonly ClaudeLaunchProfile[],
  account: AccountProfile,
): LaunchPlan {
  const configDir = account.configDir ?? "";
  const match = profileForConfigDir(profiles, configDir || DEFAULT_CONFIG_DIR);
  if (match) {
    return {
      command: match.command,
      exportConfigDir: match.ownsConfigDir ? "" : exportFor(configDir),
      unquoted: true,
    };
  }
  const exe = (account.executablePath ?? "").trim();
  return { command: exe || "claude", exportConfigDir: exportFor(configDir), unquoted: !exe };
}

/** Wrap an argument in single quotes for safe inclusion in a shell command. */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Argv for running a launch command through an interactive login shell.
 *
 * Needed wherever a command may be a shell alias: an alias exists only inside a
 * shell that sourced the user's rc files, so it cannot be spawned directly. The
 * command is spliced unquoted (quoting suppresses the expansion) and every
 * argument is quoted, so only `command` is ever interpreted as shell syntax —
 * which is why callers must reject anything `isValidLaunchCommand` refuses,
 * including values that arrived over RPC.
 */
export function loginShellArgs(command: string, args: readonly string[]): string[] {
  const line = [command, ...args.map(shellQuote)].join(" ");
  return ["-i", "-l", "-c", line];
}

/**
 * Add discovered profiles to the configured ones, keeping what the user wrote.
 *
 * Detection is a convenience, not an authority: an account the user has already
 * configured by hand is left exactly as it is, and only accounts with no profile
 * yet gain one.
 */
export function mergeLaunchProfiles(
  configured: readonly ClaudeLaunchProfile[],
  detected: readonly ClaudeLaunchProfile[],
): ClaudeLaunchProfile[] {
  const merged = [...configured];
  for (const candidate of detected) {
    if (!profileForConfigDir(merged, candidate.configDir)) merged.push(candidate);
  }
  return merged;
}

/**
 * What to tell the user after profiles were added on their behalf.
 *
 * Names every command and where the profiles live, because this writes to their
 * settings: a change made for them has to be a change they can find and undo.
 */
export function describeAddedProfiles(added: readonly ClaudeLaunchProfile[]): string {
  const commands = added.map((p) => p.command).join(", ");
  const count = `${added.length} Claude launch profile${added.length === 1 ? "" : "s"}`;
  return `SPEXR added ${count} from your shell aliases: ${commands}. Sessions for those accounts now start with them — edit or remove under "spexr.claude.launchProfiles" in Settings.`;
}
