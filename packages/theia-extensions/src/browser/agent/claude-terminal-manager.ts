import { injectable, inject, optional } from "@theia/core/shared/inversify";
import { Disposable, DisposableCollection } from "@theia/core";
import { Deferred } from "@theia/core/lib/common/promise-util";
import { ApplicationShell } from "@theia/core/lib/browser";
import { MessageService } from "@theia/core/lib/common/message-service";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { PreferenceScope } from "@theia/core/lib/common/preferences/preference-scope";
import { nls } from "@theia/core/lib/common/nls";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import { AGENT_TERMINAL_KIND } from "../terminal/terminal-style.js";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import type { ClaudeProfileDto, MemoryLinkStatus } from "../../common/agent-protocol.js";
import { SpexrAgentServiceProxy } from "./agent-service-proxy.js";
import type { SpexrAgentService } from "./agent-service-proxy.js";
import { isClaudeReady } from "./claude-readiness.js";
import { expandLeftPanelWithMinWidth } from "../shell/side-panel.js";
import {
  SPEXR_CLAUDE_EXECUTABLE_PREFERENCE,
  SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE,
  SPEXR_CLAUDE_PROFILE_ID_PREFERENCE,
  SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
} from "../preferences/spexr-preferences.js";

export const CLAUDE_TERMINAL_ID = "spexr-claude";

/** Wrap an argument in single quotes for safe inclusion in a shell command. */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Quiet period after the last PTY output that signals the TUI finished rendering. */
const READY_IDLE_MS = 1_200;

/** Hard cap so a kickoff prompt is sent even if output never goes quiet. */
const READY_TIMEOUT_MS = 15_000;

/**
 * Owns the lifecycle and placement of the embedded `claude` terminal widget.
 *
 * A single `TerminalWidget` is created per workspace and relocated between the
 * left side-panel and the main area by the expand/collapse toggle. All launch
 * and placement operations go through this manager so consumers (bootstrap,
 * commands, welcome card) never duplicate the profile-resolution flow.
 */
@injectable()
export class ClaudeTerminalManager {
  @inject(TerminalService)
  private readonly terminalService!: TerminalService;

  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  @optional()
  @inject(SpexrAgentServiceProxy)
  private readonly agentService!: SpexrAgentService | undefined;

  private widget: TerminalWidget | undefined;

  /** Resolves when the launched CLI is ready to accept typed input. */
  private readyPromise: Promise<void> = Promise.resolve();

  /** Tracks where the widget currently lives ("left" or "main"). */
  private placement: "left" | "main" = "left";

  /** Id of the expert persona the running terminal was launched with. */
  private currentExpertId: string | undefined;

  /**
   * Ensure a Claude session is running and visible.
   *
   * Reveals the existing terminal when present; otherwise resolves the account
   * profile and launches a new one. Surfaces missing-workspace / missing-CLI
   * conditions as notifications instead of throwing.
   */
  async ensureStarted(): Promise<void> {
    if (this.widget && !this.widget.isDisposed) {
      await this.reveal();
      return;
    }

    const existing = this.terminalService.getById(CLAUDE_TERMINAL_ID);
    if (existing) {
      this.widget = existing;
      existing.setTitle(nls.localize("spexr/agent/title", "Agent"));
      await this.reveal();
      return;
    }

    const activeId = this.activeExpertId();
    const expert = activeId ? await this.resolveExpert(activeId) : undefined;
    await this.launchSession(expert);
  }

  /**
   * Launch a session as the given expert (or the base agent when undefined),
   * reusing the existing terminal slot if a different one is running.
   *
   * @param expert  Minimal expert info for title/icon, or undefined for base.
   */
  async startWithExpert(expert: { id: string; name: string; icon: string }): Promise<void> {
    const firstRoot = this.workspace.tryGetRoots()[0];
    if (firstRoot) {
      await this.preferences.set(
        SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
        expert.id,
        PreferenceScope.Folder,
        firstRoot.resource.toString(),
      );
    }
    if (this.widget && !this.widget.isDisposed && this.currentExpertId === expert.id) {
      await this.reveal();
      return;
    }
    this.disposeCurrent();
    await this.launchSession(expert);
  }

  /**
   * Clear the active expert and relaunch the base agent (no persona).
   *
   * The installed expert files under `docs/agents/` are left untouched; only
   * the active selection is reset. Relaunches the single terminal because the
   * persona is fixed at process start.
   */
  async deactivateExpert(): Promise<void> {
    const firstRoot = this.workspace.tryGetRoots()[0];
    if (firstRoot) {
      await this.preferences.set(
        SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE,
        "",
        PreferenceScope.Folder,
        firstRoot.resource.toString(),
      );
    }
    this.disposeCurrent();
    await this.launchSession(undefined);
  }

  private activeExpertId(): string | undefined {
    const stored = this.preferences.get<string>(SPEXR_EXPERTS_ACTIVE_ID_PREFERENCE) ?? "";
    return stored.trim() || undefined;
  }

  private async resolveExpert(
    id: string,
  ): Promise<{ id: string; name: string; icon: string } | undefined> {
    if (!this.agentService) return undefined;
    try {
      const all = await this.agentService.listMarketplaceExperts();
      const found = all.find((e) => e.id === id);
      return found ? { id: found.id, name: found.name, icon: found.icon } : undefined;
    } catch {
      return undefined;
    }
  }

  private disposeCurrent(): void {
    if (this.widget && !this.widget.isDisposed) this.widget.dispose();
    const adopted = this.terminalService.getById(CLAUDE_TERMINAL_ID);
    adopted?.dispose();
    this.widget = undefined;
    this.currentExpertId = undefined;
  }

  private async launchSession(
    expert?: { id: string; name: string; icon: string },
  ): Promise<void> {
    const firstRoot = this.workspace.tryGetRoots()[0];
    if (!firstRoot) {
      void this.messages.info("SPEXR: open a workspace to start the Claude session.");
      return;
    }
    if (!this.agentService) return;

    const workspaceRoot = firstRoot.resource.path.toString();
    const workspaceUri = firstRoot.resource.toString();

    try {
      const profile = await this.resolveProfile(workspaceUri);
      if (!profile) return;
      await this.linkMemory(workspaceRoot);
      const shellArgs = await this.buildShellArgs(workspaceRoot, expert?.id);
      await this.launch(workspaceRoot, profile, shellArgs, expert);
      this.currentExpertId = expert?.id;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      void this.messages.error(`SPEXR: ${message}`);
    }
  }

  /**
   * Spawn the agent through an interactive login shell (`-i -l`) so the user's
   * full environment — PATH, HOME, proxies — is present; a bare direct spawn
   * loses the env the shell re-derives and made Claude re-onboard.
   *
   * The account is set authoritatively in the `-c` line: `export CLAUDE_CONFIG_DIR`
   * for a profile that carries one, and `unset CLAUDE_CONFIG_DIR` for the default
   * profile so it uses `~/.claude` even when the host env has a stray
   * CLAUDE_CONFIG_DIR (e.g. a shell that exports one). The resolved executable is
   * invoked directly — never an account alias.
   */
  private resolveShell(profile: ClaudeProfileDto, shellArgs: string[]): { shellArgs: string[] } {
    const bin = profile.executablePath ? shellQuote(profile.executablePath) : "claude";
    const account = profile.configDir
      ? `export CLAUDE_CONFIG_DIR=${shellQuote(profile.configDir)}`
      : "unset CLAUDE_CONFIG_DIR";
    const line = `${account}; ${[bin, ...shellArgs.map(shellQuote)].join(" ")}`;
    return { shellArgs: ["-i", "-l", "-c", line] };
  }

  private async buildShellArgs(workspaceRoot: string, expertId?: string): Promise<string[]> {
    const ctx = await this.agentService!.buildLaunchContext(workspaceRoot, expertId);
    if (ctx.appendSystemPromptFile) {
      return ["--append-system-prompt-file", ctx.appendSystemPromptFile];
    }
    if (ctx.appendSystemPromptInline) {
      return ["--append-system-prompt", ctx.appendSystemPromptInline];
    }
    return [];
  }

  /**
   * Resolve the configDir that the active profile would use.
   *
   * Returns the trimmed preference value, or `undefined` when the preference
   * is unset (which maps to the CLI default `~/.claude`).
   */
  currentConfigDir(): string | undefined {
    const stored = this.preferences.get<string>(SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE) ?? "";
    return stored.trim() || undefined;
  }

  /**
   * Link the workspace `memory/` folder into the Claude native per-project
   * memory location.  Best-effort: a `blocked` result is surfaced as a warning
   * but does not prevent launch.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   */
  async linkMemory(workspaceRoot: string): Promise<void> {
    if (!this.agentService) return;
    const result = await this.agentService.linkProjectMemory(
      workspaceRoot,
      this.currentConfigDir(),
    );
    if (result.status === "blocked" || result.status === "error") {
      void this.messages.warn(`SPEXR memory link: ${result.message ?? result.status}`);
    }
  }

  /**
   * Resolve a conflict at the Claude native per-project memory location by
   * backing up whatever is there and creating a fresh link to the workspace
   * `memory/` folder.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   */
  async resolveMemoryConflict(workspaceRoot: string): Promise<void> {
    if (!this.agentService) return;
    const result = await this.agentService.resolveMemoryConflict(
      workspaceRoot,
      this.currentConfigDir(),
    );
    if (result.status === "error") {
      void this.messages.warn(`SPEXR memory resolve: ${result.message ?? result.status}`);
    }
  }

  /**
   * Unlink the Claude native per-project memory symlink for the given workspace.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   */
  async unlinkMemory(workspaceRoot: string): Promise<void> {
    if (!this.agentService) return;
    const result = await this.agentService.unlinkProjectMemory(
      workspaceRoot,
      this.currentConfigDir(),
    );
    if (result.status === "blocked" || result.status === "error") {
      void this.messages.warn(`SPEXR memory unlink: ${result.message ?? result.status}`);
    }
  }

  /**
   * Report whether the workspace memory is currently symlinked into the active
   * profile's Claude config dir. Returns `"unknown"` when the backend proxy is
   * unavailable.
   *
   * @param workspaceRoot  Absolute path to the open workspace.
   */
  async memoryLinkStatus(workspaceRoot: string): Promise<MemoryLinkStatus> {
    if (!this.agentService) return "unknown";
    const result = await this.agentService.getMemoryLinkStatus(
      workspaceRoot,
      this.currentConfigDir(),
    );
    return result.status;
  }

  /**
   * Launch the `claude` CLI in a new terminal widget docked into the left panel.
   *
   * Picks up `CLAUDE_CONFIG_DIR` from the profile when present and retains the
   * widget so `reveal()`, `send()`, and `toggleExpand()` operate on the session.
   */
  private async launch(
    workspaceRoot: string,
    profile: ClaudeProfileDto,
    shellArgs: string[],
    expert?: { id: string; name: string; icon: string },
  ): Promise<void> {
    const env: { [k: string]: string | null } = profile.configDir
      ? { CLAUDE_CONFIG_DIR: profile.configDir }
      : {};

    const term = await this.terminalService.newTerminal({
      id: CLAUDE_TERMINAL_ID,
      title: expert
        ? nls.localize("spexr/agent/expertTitle", "Agent · {0}", expert.name)
        : nls.localize("spexr/agent/title", "Agent"),
      useServerTitle: false,
      iconClass: expert ? `codicon ${expert.icon}` : "codicon codicon-sparkle",
      ...this.resolveShell(profile, shellArgs),
      cwd: workspaceRoot,
      env,
      destroyTermOnClose: false,
      kind: AGENT_TERMINAL_KIND,
    });
    this.armReadiness(term);
    await term.start();

    this.widget = term;
    this.placement = "left";
    await this.shell.addWidget(term, { area: "left", rank: 1 });
    await this.reveal();
  }

  /**
   * Arm `readyPromise` to resolve once the CLI is ready for input.
   *
   * Subscribes before `term.start()` so no early output is missed, then resolves
   * on the first of: the claude ready marker in the output (fast path), the PTY
   * output going quiet for {@link READY_IDLE_MS} after the TUI finished rendering,
   * terminal close, or a hard timeout — so a kickoff prompt is delivered even if
   * the marker text changes between CLI versions.
   */
  private armReadiness(term: TerminalWidget): void {
    const deferred = new Deferred<void>();
    this.readyPromise = deferred.promise;
    const disposables = new DisposableCollection();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const settle = (): void => {
      if (deferred.state === "unresolved") deferred.resolve();
      disposables.dispose();
    };
    let tail = "";
    disposables.push(
      term.onOutput((chunk) => {
        tail = (tail + chunk).slice(-4000);
        if (isClaudeReady(tail)) {
          settle();
          return;
        }
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(settle, READY_IDLE_MS);
      }),
    );
    disposables.push(term.onTerminalDidClose(() => settle()));
    const hardTimer = setTimeout(settle, READY_TIMEOUT_MS);
    disposables.push(
      Disposable.create(() => {
        clearTimeout(hardTimer);
        if (idleTimer) clearTimeout(idleTimer);
      }),
    );
  }

  /** Resolves when the running session is ready to accept typed input. */
  async whenReady(): Promise<void> {
    return this.readyPromise;
  }

  /** Returns the current terminal widget, or `undefined` before launch. */
  current(): TerminalWidget | undefined {
    return this.widget;
  }

  /** Reveal the terminal in its current placement and expand its panel. */
  async reveal(): Promise<void> {
    const term = this.widget;
    if (!term) return;
    await this.shell.revealWidget(term.id);
    await this.shell.activateWidget(term.id);
    if (this.placement === "left") this.expandLeftPanel();
  }

  /**
   * Send text to the terminal's stdin (e.g. a prompt followed by a newline).
   * No-op when no terminal has been launched yet.
   */
  send(text: string): void {
    this.widget?.sendText(text);
  }

  /** Returns the current placement of the widget. */
  getPlacement(): "left" | "main" {
    return this.placement;
  }

  /**
   * Relocate the terminal widget between the left panel and the main area.
   *
   * Moving to main activates the widget; moving back to left reveals and expands
   * the side panel. `placement` is updated to reflect the new location.
   */
  async toggleExpand(): Promise<void> {
    const term = this.widget;
    if (!term) {
      await this.ensureStarted();
      return;
    }
    if (this.placement === "left") {
      await this.shell.addWidget(term, { area: "main", rank: 2 });
      await this.shell.activateWidget(term.id);
      this.placement = "main";
    } else {
      await this.shell.addWidget(term, { area: "left", rank: 1 });
      this.placement = "left";
      await this.reveal();
    }
  }

  private expandLeftPanel(): void {
    expandLeftPanelWithMinWidth(this.shell);
  }

  private async resolveProfile(_workspaceUri: string): Promise<ClaudeProfileDto | undefined> {
    const storedProfileId = this.preferences.get<string>(SPEXR_CLAUDE_PROFILE_ID_PREFERENCE) ?? "";
    const storedExecPath = this.preferences.get<string>(SPEXR_CLAUDE_EXECUTABLE_PREFERENCE) ?? "";
    const storedConfigDir = this.preferences.get<string>(SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE) ?? "";

    if (storedProfileId) {
      return this.buildProfileDto(storedProfileId, storedExecPath, storedConfigDir);
    }

    // No profile stored — auto-select the first detected profile without prompting.
    // Configure spexr.claude.* preferences in workspace settings for per-folder overrides.
    const profiles = await this.agentService!.detectClaudeProfiles();
    return profiles[0];
  }

  private buildProfileDto(id: string, executablePath: string, configDir: string): ClaudeProfileDto {
    return {
      id,
      label: id,
      executablePath: executablePath || "claude",
      ...(configDir.trim() ? { configDir: configDir.trim() } : {}),
    };
  }

}
