import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "node:child_process";

/**
 * A detected Claude account profile derived from the user's shell configuration.
 *
 * The `default` profile always exists with no `configDir`; additional entries
 * correspond to shell aliases or functions that launch Claude with a custom
 * `CLAUDE_CONFIG_DIR`.
 */
export interface ClaudeProfile {
  /** Unique stable identifier (URL-safe, e.g. "default" or the alias name). */
  readonly id: string;
  /** Human-readable label shown in the quick-pick. */
  readonly label: string;
  /** Resolved absolute path to the Claude Code CLI binary. */
  readonly executablePath: string;
  /** When set, passed as `CLAUDE_CONFIG_DIR` to the spawned CLI. */
  readonly configDir?: string;
}

/**
 * Dependency-light DTO transmitted over JSON-RPC.
 *
 * Mirrors `ClaudeProfile` — kept separate so `common/agent-protocol.ts`
 * has no dependency on node-only modules.
 */
export interface ClaudeProfileDto {
  readonly id: string;
  readonly label: string;
  readonly executablePath: string;
  readonly configDir?: string;
}

// ---------------------------------------------------------------------------
// Pure shell-profile parsers (exported for unit tests)
// ---------------------------------------------------------------------------

interface ParsedAlias {
  readonly label: string;
  readonly configDir: string;
}

/**
 * Parse a posix shell profile file (zsh / bash) for `alias` definitions that
 * launch Claude with a `CLAUDE_CONFIG_DIR` override.
 *
 * Recognises both single-quoted and double-quoted alias bodies, e.g.:
 *   `alias claude-perso='CLAUDE_CONFIG_DIR=~/.claude-perso claude'`
 *   `alias claude-work="CLAUDE_CONFIG_DIR=/home/u/.claude-work claude"`
 *
 * @param text  Raw file content.
 * @returns     Array of `{label, configDir}` pairs (configDir with `~` expanded).
 */
export function parsePosixProfiles(text: string): ParsedAlias[] {
  const results: ParsedAlias[] = [];
  const aliasRe =
    /^\s*alias\s+([\w-]+)\s*=\s*(?:'([^']*)'|"([^"]*)")/gm;

  let match: RegExpExecArray | null;
  while ((match = aliasRe.exec(text)) !== null) {
    const [, name, singleBody, doubleBody] = match;
    const body = singleBody ?? doubleBody ?? "";
    const configDir = extractConfigDir(body);
    const hasClaudeCommand = /(^|[\s;])claude([\s;]|$)/.test(body);
    if (configDir && hasClaudeCommand && name) {
      results.push({ label: name, configDir: expandHome(configDir) });
    }
  }
  return results;
}

/**
 * Parse a fish shell config file for `alias` or `function` blocks that launch
 * Claude with a `CLAUDE_CONFIG_DIR` override.
 *
 * Supports:
 *   `alias NAME 'CLAUDE_CONFIG_DIR=VALUE claude'`
 *   `function NAME; set -x CLAUDE_CONFIG_DIR VALUE; ...; claude ...; end`
 *
 * @param text  Raw file content.
 * @returns     Array of `{label, configDir}` pairs.
 */
export function parseFishProfiles(text: string): ParsedAlias[] {
  const results: ParsedAlias[] = [];
  results.push(...parseFishAliases(text));
  results.push(...parseFishFunctions(text));
  return results;
}

function parseFishAliases(text: string): ParsedAlias[] {
  const results: ParsedAlias[] = [];
  const aliasRe = /^\s*alias\s+([\w-]+)\s+(?:'([^']*)'|"([^"]*)")/gm;
  let match: RegExpExecArray | null;
  while ((match = aliasRe.exec(text)) !== null) {
    const [, name, singleBody, doubleBody] = match;
    const body = singleBody ?? doubleBody ?? "";
    const configDir = extractConfigDir(body);
    const hasClaudeCommand = /(^|[\s;])claude([\s;]|$)/.test(body);
    if (configDir && hasClaudeCommand && name) {
      results.push({ label: name, configDir: expandHome(configDir) });
    }
  }
  return results;
}

function parseFishFunctions(text: string): ParsedAlias[] {
  const results: ParsedAlias[] = [];
  const funcRe = /^\s*function\s+([\w-]+)([\s\S]*?)^\s*end\b/gm;
  let match: RegExpExecArray | null;
  while ((match = funcRe.exec(text)) !== null) {
    const [, name, body] = match;
    const setRe = /set\s+-(?:[a-z]*x[a-z]*)\s+CLAUDE_CONFIG_DIR\s+(\S+)/;
    const setMatch = setRe.exec(body ?? "");
    const hasClaudeCommand = /(^|[\s;])claude([\s;]|$)/.test(body ?? "");
    if (setMatch?.[1] && hasClaudeCommand && name) {
      results.push({ label: name, configDir: expandHome(setMatch[1]) });
    }
  }
  return results;
}

/**
 * Parse a PowerShell profile file for function definitions that launch Claude
 * with a `CLAUDE_CONFIG_DIR` override.
 *
 * Recognises:
 *   `function NAME { $env:CLAUDE_CONFIG_DIR='VALUE'; claude ... }`
 *
 * @param text  Raw file content.
 * @returns     Array of `{label, configDir}` pairs.
 */
export function parsePowershellProfiles(text: string): ParsedAlias[] {
  const results: ParsedAlias[] = [];
  const funcRe = /^\s*function\s+([\w-]+)\s*\{([^}]*)\}/gm;
  let match: RegExpExecArray | null;
  while ((match = funcRe.exec(text)) !== null) {
    const [, name, body] = match;
    const envRe = /\$env:CLAUDE_CONFIG_DIR\s*=\s*['"]?([^'"\s;]+)['"]?/;
    const envMatch = envRe.exec(body ?? "");
    const hasClaudeCommand = /(^|[\s;])claude([\s;]|$)/.test(body ?? "");
    if (envMatch?.[1] && hasClaudeCommand && name) {
      results.push({ label: name, configDir: expandHome(envMatch[1]) });
    }
  }
  return results;
}

/**
 * Unified entry point for tests — dispatches to the right parser by kind.
 *
 * @param text  Raw profile file content.
 * @param kind  Shell profile kind.
 * @returns     Detected `{label, configDir}` pairs.
 */
export function parseClaudeProfiles(
  text: string,
  kind: "posix" | "fish" | "powershell",
): ParsedAlias[] {
  if (kind === "fish") return parseFishProfiles(text);
  if (kind === "powershell") return parsePowershellProfiles(text);
  return parsePosixProfiles(text);
}

// ---------------------------------------------------------------------------
// Filesystem-level resolver (shared with backend service)
// ---------------------------------------------------------------------------

/**
 * Scans each directory on `process.env.PATH` for an executable named `claude`.
 *
 * Returns the resolved absolute path when exactly one candidate exists,
 * `undefined` when none exist, and `"ambiguous"` when more than one distinct
 * path is found.
 */
export function resolveClaudeExecutable(): string | "ambiguous" | undefined {
  const pathDirs = (process.env["PATH"] ?? "").split(path.delimiter).filter(Boolean);
  const candidates = new Set<string>();

  for (const dir of pathDirs) {
    const candidate = path.join(dir, "claude");
    if (isFileExecutable(candidate)) candidates.add(candidate);
  }

  if (candidates.size === 0) return undefined;
  if (candidates.size > 1) return "ambiguous";
  return [...candidates][0]!;
}

/**
 * Resolve `claude` through the user's interactive login shell, so its real PATH
 * (e.g. `~/.local/bin`, nvm shims) is searched even when the host process has a
 * stripped PATH — as a GUI app launched from Finder/Dock does. Returns an
 * absolute path, or `undefined` if the shell can't resolve it. Best-effort: any
 * failure (no shell, timeout, non-file) yields `undefined`.
 */
export function resolveClaudeExecutableViaShell(): string | undefined {
  if (process.platform === "win32") return undefined; // login-shell trick is posix-only
  const shell = process.env["SHELL"] || "/bin/zsh";
  try {
    const out = execFileSync(shell, ["-l", "-i", "-c", "command -v claude"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    // Take the last non-empty line — rc files may print banners before it.
    const line = out.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
    return line && path.isAbsolute(line) && isFileExecutable(line) ? line : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Best resolved `claude` path: the PATH scan first (fast, exactly-one-match), then
 * the login-shell fallback for stripped-PATH hosts. `undefined` when unresolved,
 * `"ambiguous"` only when the PATH scan itself found several distinct binaries.
 */
export function resolveClaudeExecutableRobust(): string | "ambiguous" | undefined {
  const scanned = resolveClaudeExecutable();
  if (typeof scanned === "string") return scanned;
  if (scanned === "ambiguous") return "ambiguous";
  return resolveClaudeExecutableViaShell();
}

/**
 * Returns `true` if the given path points to a regular executable file.
 */
export function isFileExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// High-level profile discovery
// ---------------------------------------------------------------------------

/**
 * Discover Claude account profiles from the current user's shell configuration.
 *
 * Always returns at least one entry — the `default` profile (no configDir).
 * Additional entries correspond to shell aliases or functions that set
 * `CLAUDE_CONFIG_DIR` before launching `claude`.
 *
 * This function is fail-soft: unreadable or unparseable files are silently
 * skipped; it never throws.
 */
export function detectClaudeProfiles(): ClaudeProfile[] {
  const resolvedExec = resolveClaudeExecutableRobust();
  const executablePath = typeof resolvedExec === "string" ? resolvedExec : "claude";

  const profiles: ClaudeProfile[] = [
    { id: "default", label: "Default", executablePath },
  ];

  const seen = new Set<string>();
  const profileFiles = collectProfileFiles();

  for (const { filePath, kind } of profileFiles) {
    const text = safeReadFile(filePath);
    if (text === undefined) continue;

    const parsed = parseClaudeProfiles(text, kind);
    for (const entry of parsed) {
      const key = entry.configDir;
      if (seen.has(key)) continue;
      seen.add(key);
      profiles.push({
        id: entry.label,
        label: entry.label,
        executablePath,
        configDir: entry.configDir,
      });
    }
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface ProfileFileSpec {
  readonly filePath: string;
  readonly kind: "posix" | "fish" | "powershell";
}

function collectProfileFiles(): ProfileFileSpec[] {
  if (process.platform === "win32") return collectWindowsProfiles();
  return collectPosixProfiles();
}

function collectWindowsProfiles(): ProfileFileSpec[] {
  const userProfile = process.env["USERPROFILE"] ?? os.homedir();
  const candidates = [
    path.join(userProfile, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(userProfile, "Documents", "PowerShell", "profile.ps1"),
    path.join(userProfile, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1"),
    path.join(userProfile, "Documents", "WindowsPowerShell", "profile.ps1"),
  ];
  return candidates.map((filePath) => ({ filePath, kind: "powershell" as const }));
}

function collectPosixProfiles(): ProfileFileSpec[] {
  const home = os.homedir();
  const posixFiles: ProfileFileSpec[] = [
    { filePath: path.join(home, ".zshrc"), kind: "posix" },
    { filePath: path.join(home, ".zshenv"), kind: "posix" },
    { filePath: path.join(home, ".zprofile"), kind: "posix" },
    { filePath: path.join(home, ".bashrc"), kind: "posix" },
    { filePath: path.join(home, ".bash_profile"), kind: "posix" },
    { filePath: path.join(home, ".profile"), kind: "posix" },
    { filePath: path.join(home, ".config", "fish", "config.fish"), kind: "fish" },
  ];
  return posixFiles;
}

function safeReadFile(filePath: string): string | undefined {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function extractConfigDir(body: string): string | undefined {
  const re = /CLAUDE_CONFIG_DIR=(\S+)/;
  const match = re.exec(body);
  return match?.[1];
}

function expandHome(value: string): string {
  if (value.startsWith("~/") || value === "~") {
    return path.join(os.homedir(), value.slice(1));
  }
  if (value.startsWith("$HOME/") || value === "$HOME") {
    return path.join(os.homedir(), value.slice(5));
  }
  return value;
}
