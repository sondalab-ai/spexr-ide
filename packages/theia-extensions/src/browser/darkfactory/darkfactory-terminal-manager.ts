import { injectable, inject } from "@theia/core/shared/inversify";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import { IShellTerminalServer } from "@theia/terminal/lib/common/shell-terminal-protocol";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import {
  SPEXR_CLAUDE_EXECUTABLE_PREFERENCE,
  SPEXR_CLAUDE_ACTIVE_PROFILE_PREFERENCE,
} from "../preferences/spexr-preferences.js";
import {
  accountForConfigDir,
  AMBIGUOUS_ACCOUNT,
  isHomeRelative,
  launchPlanFor,
  resolveAccount,
  shellQuoteConfigDir,
  type LaunchPlan,
} from "../../common/claude-launch-profiles.js";
import { readLaunchProfiles } from "../preferences/launch-profiles.js";
import { claudeCore } from "../../common/harness/claude-harness-core.js";
import { opencodeCore } from "../../common/harness/opencode-harness-core.js";
import type { ClaudeLaunchProfile } from "../../common/claude-launch-profiles.js";
import type { HarnessCore, HarnessId } from "../../common/harness/harness-types.js";
import { SESSION_TERMINAL_KIND } from "../terminal/terminal-style.js";
import { evictOnAttachFailure, isReusableTerminal } from "../terminal/terminal-liveness.js";
import { fallBackOnContextLoss } from "../terminal/terminal-attach.js";
import type { StoredTerminal } from "./pinned-store.js";

/** Wrap an argument in single quotes for safe inclusion in a shell command. */
function shellQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** A workspace path as the resource uri folder-scoped preferences are keyed by. */
function resourceUriFor(projectPath: string): string | undefined {
  return projectPath ? `file://${projectPath}` : undefined;
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
  @inject(IShellTerminalServer) private readonly shellServer!: IShellTerminalServer;

  private readonly widgets = new Map<string, TerminalWidget>();
  /** Key → OS process id of its terminal, recorded once the process has started. */
  private readonly processIds = new Map<string, number>();

  /**
   * The terminal already running for a session, if any. Callers use this to
   * re-attach a session they are showing again: asking the backend to plan the
   * focus instead would route them to a read-only follow, because our own
   * terminal is the running process that makes the session look live.
   *
   * A terminal whose backend process is gone is not reported as live, so the
   * card falls back to the read-only follow instead of embedding a widget that
   * looks interactive and accepts nothing.
   */
  live(sessionId: string): TerminalWidget | undefined {
    const term = this.widgets.get(sessionId);
    return term && isReusableTerminal(term) ? term : undefined;
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
    if (existing && isReusableTerminal(existing)) return existing;
    this.evict(sessionId);
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
    if (existing && isReusableTerminal(existing)) return existing;
    this.evict(key);
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
    const processId = this.processIds.get(from);
    this.processIds.delete(from);
    if (processId !== undefined) this.processIds.set(to, processId);
    term.onDidDispose(() => {
      this.widgets.delete(to);
      this.processIds.delete(to);
    });
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
    const dir = harness.id === "claude" ? this.resolveConfigDir(configDir, projectPath) : "";
    const plan = this.launchPlan(harness, dir, projectPath);
    const term = await this.terminalService.newTerminal({
      id: `spexr-df-${key}`,
      title: baseName(projectPath),
      useServerTitle: false,
      iconClass: "codicon codicon-sparkle",
      ...this.resolveShell(plan, args, projectPath, harness.id === "claude"),
      cwd: projectPath,
      // Home-relative dirs are left to the shell line: the env is not a shell,
      // so a `~` handed over here would stay literal.
      env:
        plan.exportConfigDir && !isHomeRelative(plan.exportConfigDir)
          ? { CLAUDE_CONFIG_DIR: plan.exportConfigDir }
          : {},
      destroyTermOnClose: false,
      kind: SESSION_TERMINAL_KIND,
    });
    await term.start();
    await this.register(key, term);
    return term;
  }

  /**
   * Keep a started terminal under `key`: the manager forgets it when it is
   * disposed, evicts it when a later re-attach finds no process, and records
   * its OS process id for {@link terminalInfo}.
   */
  private async register(key: string, term: TerminalWidget): Promise<void> {
    this.widgets.set(key, term);
    term.onDidDispose(() => {
      this.widgets.delete(key);
      this.processIds.delete(key);
    });
    // Awaited, so a card saved right after it opens already knows its process.
    try {
      this.processIds.set(key, await term.processId);
    } catch {
      // not started after all; the eviction below takes care of it
    }
    // Subscribed after the first start so this only ever reports a *later*
    // death: a re-attach that found no process, typically after the frontend
    // reconnected to the backend on wake from standby.
    evictOnAttachFailure(term, () => this.evict(key));
    fallBackOnContextLoss(term);
  }

  /**
   * What a card stores to find its terminal again after a window reload: the
   * backend terminal id and the process running in it. Undefined when the card
   * has no live terminal, or its process id is not known yet.
   */
  terminalInfo(key: string): StoredTerminal | undefined {
    const term = this.live(key);
    const processId = this.processIds.get(key);
    return term && processId !== undefined ? { terminalId: term.terminalId, processId } : undefined;
  }

  /**
   * Show a card the terminal it had before a window reload. The backend keeps
   * session processes across a reload, but a new frontend has no widget for
   * them. The process id is checked before attaching: terminal ids start over
   * when the backend restarts, and attaching to another process would put
   * somebody else's shell in the card (and disposing that widget would kill
   * it). Returns undefined when the process is gone or the id is not ours.
   */
  async reattach(
    key: string,
    stored: StoredTerminal,
    projectPath: string,
  ): Promise<TerminalWidget | undefined> {
    const existing = this.live(key);
    if (existing) return existing;
    const processId = await this.shellServer.getProcessId(stored.terminalId).catch(() => -1);
    if (processId !== stored.processId) return undefined;
    const term = await this.terminalService.newTerminal({
      id: `spexr-df-${key}`,
      title: baseName(projectPath),
      useServerTitle: false,
      iconClass: "codicon codicon-sparkle",
      destroyTermOnClose: false,
      kind: SESSION_TERMINAL_KIND,
    });
    try {
      await term.start(stored.terminalId);
    } catch {
      return undefined; // the process ended in between; the widget holds no id to close
    }
    await this.register(key, term);
    return term;
  }

  /**
   * Drop a terminal that can no longer carry input, so the next open recreates
   * it. The widget is disposed rather than just forgotten: its id is derived
   * from the key, so a stale one still registered with the terminal service
   * would collide with its replacement.
   */
  private evict(key: string): void {
    const term = this.widgets.get(key);
    this.widgets.delete(key);
    if (!term || term.isDisposed) return;
    // Lumino's dispose() detaches an attached widget strictly, and throws before
    // the xterm and its connection are released if the node already left the
    // document (the Darkfactory view was closed under it). Put it back first.
    if (term.isAttached && !term.node.isConnected) document.body.appendChild(term.node);
    term.dispose();
  }

  /**
   * Run the harness through an interactive login shell, so the user's real PATH
   * (`~/.local/bin`, nvm shims) resolves it and — for a launch profile — so the
   * shell expands an alias such as `cld-perso`.
   *
   * The command is only quoted when it is a path: quoting is exactly what stops
   * zsh from expanding an alias, and `launchPlanFor` says which case this is
   * (the preference that can hold a command is restricted to a single bare word
   * for that reason). CLAUDE_CONFIG_DIR is set authoritatively inside the `-c`
   * line: exported when the plan carries an account, and unset when the command
   * owns it, so a value inherited from the shell that started SPEXR cannot
   * redirect the session behind the command's back. Opencode has no config-dir
   * override; only the `cd` is needed.
   */
  private resolveShell(
    plan: LaunchPlan,
    resumeArgs: string[],
    projectPath: string,
    ownsAccount: boolean,
  ): { shellArgs: string[] } {
    const account = plan.exportConfigDir
      ? `export CLAUDE_CONFIG_DIR=${shellQuoteConfigDir(plan.exportConfigDir)}`
      : "unset CLAUDE_CONFIG_DIR";
    const prefix = [
      ownsAccount ? account : "",
      projectPath ? `cd ${shellQuote(projectPath)}` : "",
    ]
      .filter(Boolean)
      .join("; ");
    const bin = plan.unquoted ? plan.command : shellQuote(plan.command);
    // `; exec $SHELL` keeps the terminal alive after the harness exits (e.g. a
    // resume that can't find the conversation) so the tab shows the error instead of vanishing.
    const line = `${prefix ? `${prefix}; ` : ""}${[bin, ...resumeArgs.map(shellQuote)].join(" ")}; exec "$SHELL" -i`;
    return { shellArgs: ["-i", "-l", "-c", line] };
  }

  /**
   * How to start this harness: the launch profile bound to the session's config
   * dir when there is one, else the configured executable path, else the bare
   * binary. Opencode takes no account and no profile.
   */
  private launchPlan(harness: HarnessCore, dir: string, projectPath: string): LaunchPlan {
    if (harness.id !== "claude") return { command: "opencode", exportConfigDir: "", unquoted: true };
    const resource = resourceUriFor(projectPath);
    const exe = (
      this.preferences.get<string>(SPEXR_CLAUDE_EXECUTABLE_PREFERENCE, "", resource) ?? ""
    ).trim();
    return launchPlanFor(accountForConfigDir(this.launchProfiles(projectPath), dir), exe);
  }

  /**
   * Launch profiles as the session's own project sees them.
   *
   * Read against the project rather than the window: a folder-scoped value is
   * invisible to a read that names no resource, and the wall opens sessions for
   * projects that are not the first workspace root.
   */
  private launchProfiles(projectPath: string): ClaudeLaunchProfile[] {
    return readLaunchProfiles(this.preferences, resourceUriFor(projectPath));
  }

  /**
   * CLAUDE_CONFIG_DIR for the session. The session's own config dir wins (so the
   * CLI finds the conversation); otherwise fall back to the account SPEXR runs
   * the side agent under, so a wall session started with nothing picked lands on
   * the same identity as the rest of the IDE.
   */
  private resolveConfigDir(configDir: string, projectPath: string): string {
    if (configDir.trim()) return configDir.trim();
    const resource = resourceUriFor(projectPath);
    const account = resolveAccount(
      this.preferences.get<string>(SPEXR_CLAUDE_ACTIVE_PROFILE_PREFERENCE, "", resource) ?? "",
      this.launchProfiles(projectPath),
    );
    return account === AMBIGUOUS_ACCOUNT ? "" : account.configDir.trim();
  }
}
