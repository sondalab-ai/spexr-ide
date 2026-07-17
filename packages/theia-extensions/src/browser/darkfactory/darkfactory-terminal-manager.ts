import { injectable, inject } from "@theia/core/shared/inversify";
import { ApplicationShell } from "@theia/core/lib/browser";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import {
  SPEXR_CLAUDE_EXECUTABLE_PREFERENCE,
  SPEXR_CLAUDE_LAUNCH_COMMAND_PREFERENCE,
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
 * Owns embedded `claude --resume` terminals, one per session. Each Darkfactory
 * focus request for an idle session opens (or reveals) a session-keyed terminal
 * in the main area, so several agents can be driven from one window.
 */
@injectable()
export class SpexrDarkfactoryTerminalManager {
  @inject(TerminalService) private readonly terminalService!: TerminalService;
  @inject(ApplicationShell) private readonly shell!: ApplicationShell;
  @inject(PreferenceService) private readonly preferences!: PreferenceService;

  private readonly widgets = new Map<string, TerminalWidget>();

  /**
   * Open (or reveal) an interactive terminal that resumes `sessionId` in
   * `projectPath`. `fork` uses `--fork-session` to branch from the session's
   * history when the original is live elsewhere.
   */
  async openResume(sessionId: string, projectPath: string, fork: boolean): Promise<void> {
    if (!isSessionId(sessionId) || !projectPath) return;

    const existing = this.widgets.get(sessionId);
    if (existing && !existing.isDisposed) {
      await this.revealMain(existing);
      return;
    }

    const term = await this.terminalService.newTerminal({
      id: `spexr-df-${sessionId}`,
      title: baseName(projectPath),
      useServerTitle: false,
      iconClass: "codicon codicon-sparkle",
      ...this.resolveShell(buildResumeArgs(sessionId, fork)),
      cwd: projectPath,
      env: this.configEnv(),
      destroyTermOnClose: false,
    });
    await term.start();
    this.widgets.set(sessionId, term);
    term.onDidDispose(() => this.widgets.delete(sessionId));
    await this.revealMain(term);
  }

  private async revealMain(term: TerminalWidget): Promise<void> {
    await this.shell.addWidget(term, { area: "main" });
    await this.shell.activateWidget(term.id);
  }

  /**
   * With a custom launch command set, run it through the interactive login shell
   * (so aliases/functions resolve); otherwise spawn the resolved executable.
   */
  private resolveShell(resumeArgs: string[]): { shellPath?: string; shellArgs: string[] } {
    const command = (this.preferences.get<string>(SPEXR_CLAUDE_LAUNCH_COMMAND_PREFERENCE) ?? "").trim();
    if (command) {
      const line = [command, ...resumeArgs.map(shellQuote)].join(" ");
      return { shellArgs: ["-i", "-l", "-c", line] };
    }
    const exe = (this.preferences.get<string>(SPEXR_CLAUDE_EXECUTABLE_PREFERENCE) ?? "").trim();
    return exe ? { shellPath: exe, shellArgs: resumeArgs } : { shellArgs: resumeArgs };
  }

  private configEnv(): { [k: string]: string | null } {
    const dir = (this.preferences.get<string>(SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE) ?? "").trim();
    return dir ? { CLAUDE_CONFIG_DIR: dir } : {};
  }
}
