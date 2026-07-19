import { injectable, inject } from "@theia/core/shared/inversify";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import {
  SPEXR_CLAUDE_EXECUTABLE_PREFERENCE,
  SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE,
} from "../preferences/spexr-preferences.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a string is a Claude session UUID (safe to pass to `claude --resume`). */
function isSessionId(sessionId: string): boolean {
  return UUID_RE.test(sessionId);
}

/** Args for `claude` to resume a session (caller must pass a validated sessionId). */
function buildResumeArgs(sessionId: string, fork: boolean): string[] {
  const args = ["--resume", sessionId];
  if (fork) args.push("--fork-session");
  return args;
}

/** Wrap an argument in single quotes for safe inclusion in a shell command. */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Last path segment, without importing node:path into the browser bundle. */
function baseName(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

/**
 * Owns `claude --resume` terminals, one per session, created for embedding in the
 * Darkfactory pinned card. Each terminal is keyed by session id and reused while
 * live, so several agents can be driven from one window.
 */
@injectable()
export class SpexrDarkfactoryTerminalManager {
  @inject(TerminalService) private readonly terminalService!: TerminalService;
  @inject(PreferenceService) private readonly preferences!: PreferenceService;

  private readonly widgets = new Map<string, TerminalWidget>();

  /**
   * Create (or reuse) a resume terminal WITHOUT docking it in the shell — the
   * caller attaches its node into its own container (the pinned card). `fork` uses
   * `--fork-session` to branch from the history when the original is live
   * elsewhere. Returns undefined if the session id/path is invalid or it can't start.
   */
  async openEmbedded(
    sessionId: string,
    projectPath: string,
    configDir: string,
    fork: boolean,
  ): Promise<TerminalWidget | undefined> {
    const existing = this.widgets.get(sessionId);
    if (existing && !existing.isDisposed) return existing;
    return this.createResumeTerminal(sessionId, projectPath, configDir, fork);
  }

  private async createResumeTerminal(
    sessionId: string,
    projectPath: string,
    configDir: string,
    fork: boolean,
  ): Promise<TerminalWidget | undefined> {
    if (!isSessionId(sessionId) || !projectPath) return undefined;
    const dir = this.resolveConfigDir(configDir);
    const term = await this.terminalService.newTerminal({
      id: `spexr-df-${sessionId}`,
      title: baseName(projectPath),
      useServerTitle: false,
      iconClass: "codicon codicon-sparkle",
      ...this.resolveShell(buildResumeArgs(sessionId, fork), dir, projectPath),
      cwd: projectPath,
      env: dir ? { CLAUDE_CONFIG_DIR: dir } : {},
      destroyTermOnClose: false,
    });
    await term.start();
    this.widgets.set(sessionId, term);
    term.onDidDispose(() => this.widgets.delete(sessionId));
    return term;
  }

  /**
   * Run the resume through an interactive login shell (so the user's real PATH —
   * `~/.local/bin`, nvm shims — resolves `claude`), invoking the plain `claude`
   * binary directly rather than any account alias.
   *
   * SPEXR owns the account per session: `claude --resume` resolves a conversation
   * by CLAUDE_CONFIG_DIR *and* the cwd's project slug, so both must be authoritative.
   * The login shell re-sources the profile (which may re-export CLAUDE_CONFIG_DIR or
   * `cd` away), so we re-export the session's dir and `cd` into its project inside
   * the `-c` line, after the profile has run. Using the bare binary (not an alias
   * like `claude-perso` that pins a dir) is what lets our export win.
   */
  private resolveShell(
    resumeArgs: string[],
    dir: string,
    projectPath: string,
  ): { shellArgs: string[] } {
    const exe = (this.preferences.get<string>(SPEXR_CLAUDE_EXECUTABLE_PREFERENCE) ?? "").trim();
    const bin = exe ? shellQuote(exe) : "claude";
    const prefix = [
      dir ? `export CLAUDE_CONFIG_DIR=${shellQuote(dir)}` : "",
      projectPath ? `cd ${shellQuote(projectPath)}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    // `; exec $SHELL` keeps the terminal alive after claude exits (e.g. a resume
    // that can't find the conversation) so the tab shows the error instead of vanishing.
    const line = `${prefix ? `${prefix}; ` : ""}${[bin, ...resumeArgs.map(shellQuote)].join(" ")}; exec "$SHELL" -i`;
    return { shellArgs: ["-i", "-l", "-c", line] };
  }

  /**
   * CLAUDE_CONFIG_DIR for the resume. The session's own config dir wins (so the
   * CLI finds the conversation); otherwise fall back to the SPEXR preference.
   */
  private resolveConfigDir(configDir: string): string {
    return configDir.trim() || (this.preferences.get<string>(SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE) ?? "").trim();
  }
}
