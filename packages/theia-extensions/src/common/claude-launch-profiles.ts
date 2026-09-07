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

/** What a launch needs: the command word, and whether to export the config dir. */
export interface LaunchPlan {
  readonly command: string;
  /** Config dir to export, or "" when the command sets it itself. */
  readonly exportConfigDir: string;
  /** True when `command` is a shell word that must not be quoted. */
  readonly unquoted: boolean;
}

/**
 * Decide how to launch Claude for a config dir.
 *
 * A profile wins over the executable-path preference, and a profile that sets
 * the account itself suppresses the export so the two cannot disagree. With no
 * profile the behaviour is what it was before profiles existed: the configured
 * path, or a bare `claude`, with the config dir exported.
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
      exportConfigDir: profile.ownsConfigDir ? "" : configDir,
      unquoted: true,
    };
  }
  const exe = executablePath.trim();
  return { command: exe || "claude", exportConfigDir: configDir, unquoted: !exe };
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

/** Where a Claude account profile with no explicit config dir points. */
export const DEFAULT_CONFIG_DIR = "~/.claude";

/** The parts of an account profile a launch decision depends on. */
export interface AccountProfile {
  readonly executablePath?: string;
  readonly configDir?: string;
}

/**
 * Decide how the agent terminal starts Claude for an account profile.
 *
 * Differs from `resolveLaunchPlan` in what an empty `exportConfigDir` means:
 * the agent terminal *unsets* CLAUDE_CONFIG_DIR rather than leaving it, so a
 * stray value in the host environment cannot redirect the default account. A
 * launch profile that owns the account gets the same treatment — clearing the
 * variable is what leaves the command in sole charge of it.
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
      exportConfigDir: match.ownsConfigDir ? "" : configDir,
      unquoted: true,
    };
  }
  const exe = (account.executablePath ?? "").trim();
  return { command: exe || "claude", exportConfigDir: configDir, unquoted: !exe };
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
