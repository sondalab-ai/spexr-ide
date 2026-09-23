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

/**
 * What one preference holds at each scope, innermost first.
 *
 * Mirrors the fields of Theia's `PreferenceInspection` that matter here, so the
 * precedence rule below can be tested without a preference service.
 */
export interface ScopedProfileValues {
  readonly session?: unknown;
  readonly folder?: unknown;
  readonly workspace?: unknown;
  readonly user?: unknown;
  readonly fallback?: unknown;
}

/**
 * Launch profiles from the innermost scope that actually configures any.
 *
 * Theia merges a top-level array by *replacement*, not by concatenation
 * (`PreferenceUtils.merge` copies the target when the source is not an object),
 * so an empty array at an outer scope silently erases every account configured
 * further in. That is not a hypothetical: the settings UI writes to the
 * workspace file whenever a workspace is open, and a `"launchProfiles": []`
 * left there takes away the profiles the user has at user level — leaving SPEXR
 * with one apparent account and no reason to ask which one to use.
 *
 * An empty list therefore means "nothing configured at this scope" and the
 * search continues outward, which is the only reading under which a scope can
 * add accounts without being able to destroy them.
 */
export function profilesFromScopes(scopes: ScopedProfileValues): ClaudeLaunchProfile[] {
  for (const raw of [
    scopes.session,
    scopes.folder,
    scopes.workspace,
    scopes.user,
    scopes.fallback,
  ]) {
    const profiles = parseLaunchProfiles(raw);
    if (profiles.length > 0) return profiles;
  }
  return [];
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
 * An account once it has been decided: the profile that starts it, when one is
 * configured for it, and the config dir it runs under.
 *
 * `configDir` is empty for the default account, which is named by *not* setting
 * CLAUDE_CONFIG_DIR rather than by setting it to `~/.claude` — see `exportFor`.
 */
export interface ResolvedAccount {
  readonly profile?: ClaudeLaunchProfile;
  readonly configDir: string;
}

/** The account Claude uses when CLAUDE_CONFIG_DIR is left unset. */
export const DEFAULT_ACCOUNT: ResolvedAccount = { configDir: "" };

/** Value of the active-account preference that names the default account. */
export const DEFAULT_ACCOUNT_ID = "default";

/** Returned when the user has to pick, because more than one account exists. */
export const AMBIGUOUS_ACCOUNT = "ambiguous";

/**
 * The account a config dir names.
 *
 * An empty config dir is the default account and deliberately matches no
 * profile: a profile bound to `~/.claude` describes a *wrapper* for that
 * account, and picking it up here would start a session under a command the
 * caller never asked for.
 */
export function accountForConfigDir(
  profiles: readonly ClaudeLaunchProfile[],
  configDir: string,
): ResolvedAccount {
  const profile = profileForConfigDir(profiles, configDir);
  return profile ? { profile, configDir } : { configDir: configDir.trim() };
}

/**
 * Every account the user could pick between on this machine.
 *
 * The default account is one of them: a machine with a single wrapper alias has
 * *two* identities, the alias and the one `claude` starts by hand, and treating
 * the lone profile as the only answer would silently pick for the user. It is
 * left out only when it cannot be offered as itself — a profile already bound
 * to `~/.claude` *is* that account with a wrapper in front, and a profile
 * labelled `default` has taken the name the stored choice would use.
 */
export function availableAccounts(
  profiles: readonly ClaudeLaunchProfile[],
): ResolvedAccount[] {
  const accounts = profiles.map((profile) => ({ profile, configDir: profile.configDir }));
  const covered = profiles.some(
    (p) =>
      sameConfigDir(p.configDir, DEFAULT_CONFIG_DIR) ||
      p.label.trim().toLowerCase() === DEFAULT_ACCOUNT_ID,
  );
  return covered ? accounts : [...accounts, DEFAULT_ACCOUNT];
}

/**
 * The account SPEXR should run Claude under, or {@link AMBIGUOUS_ACCOUNT} when
 * only the user can say.
 *
 * There is nothing to ask when the machine holds a single account, and a lone
 * launch profile is *not* that case — see {@link availableAccounts}.
 *
 * The stored choice names a profile by label, so the profile stays the single
 * source of truth for the command, the config dir, and who exports it. A label
 * that no longer names a profile — renamed, deleted — is not honoured silently:
 * it falls through to the same rules as an unmade choice, which re-asks when
 * there is anything to ask about and heals the stale value.
 *
 * @param activeProfile  Stored choice: a profile label, {@link DEFAULT_ACCOUNT_ID}, or empty.
 * @param profiles       Launch profiles configured for this machine.
 */
export function resolveAccount(
  activeProfile: string,
  profiles: readonly ClaudeLaunchProfile[],
): ResolvedAccount | typeof AMBIGUOUS_ACCOUNT {
  const chosen = activeProfile.trim().toLowerCase();
  // Profiles are matched first: a profile labelled "default" is the user's own,
  // and reading it as the built-in account would start the wrong identity under
  // a name they chose. `promptForAccount` stops offering the built-in item when
  // a profile claims that name, so the two can never both be on offer.
  const match = profiles.find((p) => p.label.trim().toLowerCase() === chosen);
  if (match) return { profile: match, configDir: match.configDir };
  if (chosen === DEFAULT_ACCOUNT_ID) return DEFAULT_ACCOUNT;
  const accounts = availableAccounts(profiles);
  return accounts.length > 1 ? AMBIGUOUS_ACCOUNT : (accounts[0] ?? DEFAULT_ACCOUNT);
}

/**
 * How to start Claude for a decided account.
 *
 * The account's profile wins over the executable-path preference, and a profile
 * that sets CLAUDE_CONFIG_DIR itself suppresses the export so the two cannot
 * disagree. With no profile the behaviour is what it was before profiles
 * existed: the configured path, or a bare `claude`.
 *
 * @param account         The account to run under.
 * @param executablePath  `spexr.claude.executablePath`, for a binary a profile
 *                        cannot name (a path with spaces, say).
 */
export function launchPlanFor(account: ResolvedAccount, executablePath: string): LaunchPlan {
  const { profile, configDir } = account;
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

/** Wrap an argument in single quotes for safe inclusion in a shell command. */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/**
 * Quote a config dir for a shell assignment, keeping `~` meaningful.
 *
 * Profiles are written by hand and say `~/.claude-perso`, but single quotes are
 * exactly what stops the shell expanding a tilde — the variable would reach the
 * CLI with a literal `~` in it, naming a directory relative to wherever the
 * process happens to run. The home part becomes `"$HOME"`, which the shell does
 * expand, and the rest stays single-quoted so nothing else is interpreted.
 */
export function shellQuoteConfigDir(dir: string): string {
  if (dir === "~" || dir === "$HOME") return `"$HOME"`;
  if (dir.startsWith("~/")) return `"$HOME"${shellQuote(dir.slice(1))}`;
  if (dir.startsWith("$HOME/")) return `"$HOME"${shellQuote(dir.slice("$HOME".length))}`;
  return shellQuote(dir);
}

/**
 * Whether a config dir is written relative to the home directory.
 *
 * The frontend cannot expand it — it has no home directory to expand against —
 * so such a value must not be handed to anything that treats it as a path. The
 * shell line resolves it instead, via {@link shellQuoteConfigDir}.
 */
export function isHomeRelative(dir: string): boolean {
  return dir === "~" || dir === "$HOME" || dir.startsWith("~/") || dir.startsWith("$HOME/");
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
