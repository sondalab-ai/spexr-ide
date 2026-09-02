import { injectable, inject } from "@theia/core/shared/inversify";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import {
  SPEXR_CLAUDE_EXECUTABLE_PREFERENCE,
  SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE,
} from "../preferences/spexr-preferences.js";
import { claudeCore } from "../../common/harness/claude-harness-core.js";
import { opencodeCore } from "../../common/harness/opencode-harness-core.js";
import type { HarnessCore, HarnessId } from "../../common/harness/harness-types.js";

/** Wrap an argument in single quotes for safe inclusion in a shell command. */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Last path segment, without importing node:path into the browser bundle. */
function baseName(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

/** The harness that owns a session id (by shape: UUID → claude, `ses_…` → opencode). */
function harnessForSessionId(sessionId: string): HarnessCore | undefined {
  if (claudeCore.isResumableId(sessionId)) return claudeCore;
  if (opencodeCore.isResumableId(sessionId)) return opencodeCore;
  return undefined;
}

/**
 * Owns resume terminals, one per session, created for embedding in the
 * Darkfactory pinned card. Each terminal is keyed by session id and reused while
 * live, so several agents can be driven from one window. The harness is selected
 * per session by id shape (Claude UUID vs opencode `ses_…`).
 */
@injectable()
export class SpexrDarkfactoryTerminalManager {
  @inject(TerminalService) private readonly terminalService!: TerminalService;
  @inject(PreferenceService) private readonly preferences!: PreferenceService;

  private readonly widgets = new Map<string, TerminalWidget>();

  /**
   * The terminal already running for a session, if any. Callers use this to
   * re-attach a session they are showing again: asking the backend to plan the
   * focus instead would route them to a read-only follow, because our own
   * terminal is the running process that makes the session look live.
   */
  live(sessionId: string): TerminalWidget | undefined {
    const term = this.widgets.get(sessionId);
    return term && !term.isDisposed ? term : undefined;
  }

  /**
   * Create (or reuse) a resume terminal WITHOUT docking it in the shell — the
   * caller attaches its node into its own container (the pinned card). `fork`
   * branches from the history when the original is live elsewhere. Returns
   * undefined if the session id/path is invalid or it can't start.
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

  /**
   * Start a fresh session — the harness binary with no resume argument — under a
   * caller-chosen key, since no session id exists until the harness writes its
   * transcript. {@link rekey} adopts the real id once the scan reports it.
   */
  async openNew(
    key: string,
    harnessId: HarnessId,
    projectPath: string,
    configDir: string,
  ): Promise<TerminalWidget | undefined> {
    const existing = this.widgets.get(key);
    if (existing && !existing.isDisposed) return existing;
    const harness = harnessId === "claude" ? claudeCore : opencodeCore;
    return this.create(key, harness, [], projectPath, configDir);
  }

  /**
   * Move a terminal to another key, so a session launched under a placeholder is
   * found again under the id the scan gives it. No-op when the key is unknown or
   * the destination is taken.
   */
  rekey(from: string, to: string): void {
    const term = this.widgets.get(from);
    if (!term || term.isDisposed || this.widgets.has(to)) return;
    this.widgets.delete(from);
    this.widgets.set(to, term);
    term.onDidDispose(() => this.widgets.delete(to));
  }

  private async createResumeTerminal(
    sessionId: string,
    projectPath: string,
    configDir: string,
    fork: boolean,
  ): Promise<TerminalWidget | undefined> {
    const harness = harnessForSessionId(sessionId);
    if (!harness) return undefined;
    return this.create(sessionId, harness, harness.buildResumeArgs(sessionId, fork), projectPath, configDir);
  }

  private async create(
    key: string,
    harness: HarnessCore,
    args: string[],
    projectPath: string,
    configDir: string,
  ): Promise<TerminalWidget | undefined> {
    if (!projectPath) return undefined;
    const dir = harness.id === "claude" ? this.resolveConfigDir(configDir) : "";
    const term = await this.terminalService.newTerminal({
      id: `spexr-df-${key}`,
      title: baseName(projectPath),
      useServerTitle: false,
      iconClass: "codicon codicon-sparkle",
      ...this.resolveShell(harness, args, dir, projectPath),
      cwd: projectPath,
      env: dir ? { CLAUDE_CONFIG_DIR: dir } : {},
      destroyTermOnClose: false,
    });
    await term.start();
    this.widgets.set(key, term);
    term.onDidDispose(() => this.widgets.delete(key));
    return term;
  }

  /**
   * Run the resume through an interactive login shell (so the user's real PATH —
   * `~/.local/bin`, nvm shims — resolves the harness binary), invoking the plain
   * binary directly rather than any account alias.
   *
   * For Claude, SPEXR owns the account per session: `claude --resume` resolves a
   * conversation by CLAUDE_CONFIG_DIR *and* the cwd's project slug, so both must
   * be authoritative. The login shell re-sources the profile (which may re-export
   * CLAUDE_CONFIG_DIR or `cd` away), so we re-export the session's dir and `cd`
   * into its project inside the `-c` line, after the profile has run. Opencode has
   * no config-dir override — only the `cd` is needed (the session's directory is
   * authoritative).
   */
  private resolveShell(
    harness: HarnessCore,
    resumeArgs: string[],
    dir: string,
    projectPath: string,
  ): { shellArgs: string[] } {
    const bin = this.resolveBinary(harness);
    const prefix = [
      // Set the account authoritatively so a stray CLAUDE_CONFIG_DIR in the host
      // env can't send the resume to the wrong config dir (Claude only).
      harness.id === "claude" ? `export CLAUDE_CONFIG_DIR=${shellQuote(dir)}` : "",
      projectPath ? `cd ${shellQuote(projectPath)}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    // `; exec $SHELL` keeps the terminal alive after the harness exits (e.g. a
    // resume that can't find the conversation) so the tab shows the error instead of vanishing.
    const line = `${prefix ? `${prefix}; ` : ""}${[bin, ...resumeArgs.map(shellQuote)].join(" ")}; exec "$SHELL" -i`;
    return { shellArgs: ["-i", "-l", "-c", line] };
  }

  /** The harness binary to launch: the user's explicit Claude path when set, else the bare name. */
  private resolveBinary(harness: HarnessCore): string {
    if (harness.id === "claude") {
      const exe = (this.preferences.get<string>(SPEXR_CLAUDE_EXECUTABLE_PREFERENCE) ?? "").trim();
      return exe ? shellQuote(exe) : "claude";
    }
    return "opencode";
  }

  /**
   * CLAUDE_CONFIG_DIR for the resume. The session's own config dir wins (so the
   * CLI finds the conversation); otherwise fall back to the SPEXR preference.
   */
  private resolveConfigDir(configDir: string): string {
    return configDir.trim() || (this.preferences.get<string>(SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE) ?? "").trim();
  }
}
