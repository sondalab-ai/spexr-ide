import { injectable, inject } from "@theia/core/shared/inversify";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import type { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import {
  SPEXR_CLAUDE_EXECUTABLE_PREFERENCE,
  SPEXR_CLAUDE_ACTIVE_PROFILE_PREFERENCE,
  SPEXR_CLAUDE_LAUNCH_PROFILES_PREFERENCE,
} from "../preferences/spexr-preferences.js";
import {
  accountForConfigDir,
  AMBIGUOUS_ACCOUNT,
  launchPlanFor,
  parseLaunchProfiles,
  resolveAccount,
  type LaunchPlan,
} from "../../common/claude-launch-profiles.js";
import { claudeCore } from "../../common/harness/claude-harness-core.js";
import { opencodeCore } from "../../common/harness/opencode-harness-core.js";
import type { ClaudeLaunchProfile } from "../../common/claude-launch-profiles.js";
import type { HarnessCore, HarnessId } from "../../common/harness/harness-types.js";
import { SESSION_TERMINAL_KIND } from "../terminal/terminal-style.js";
import { evictOnAttachFailure, isReusableTerminal } from "../terminal/terminal-liveness.js";

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
    const plan = this.launchPlan(harness, dir);
    const term = await this.terminalService.newTerminal({
      id: `spexr-df-${key}`,
      title: baseName(projectPath),
      useServerTitle: false,
      iconClass: "codicon codicon-sparkle",
      ...this.resolveShell(plan, args, projectPath, harness.id === "claude"),
      cwd: projectPath,
      env: plan.exportConfigDir ? { CLAUDE_CONFIG_DIR: plan.exportConfigDir } : {},
      destroyTermOnClose: false,
      kind: SESSION_TERMINAL_KIND,
    });
    await term.start();
    this.widgets.set(key, term);
    term.onDidDispose(() => this.widgets.delete(key));
    // Subscribed after the first start so this only ever reports a *later*
    // death: a re-attach that found no process, typically after the frontend
    // reconnected to the backend on wake from standby.
    evictOnAttachFailure(term, () => this.evict(key));
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
    if (term && !term.isDisposed) term.dispose();
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
      ? `export CLAUDE_CONFIG_DIR=${shellQuote(plan.exportConfigDir)}`
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
  private launchPlan(harness: HarnessCore, dir: string): LaunchPlan {
    if (harness.id !== "claude") return { command: "opencode", exportConfigDir: "", unquoted: true };
    const exe = (this.preferences.get<string>(SPEXR_CLAUDE_EXECUTABLE_PREFERENCE) ?? "").trim();
    return launchPlanFor(accountForConfigDir(this.launchProfiles(), dir), exe);
  }

  private launchProfiles(): ClaudeLaunchProfile[] {
    return parseLaunchProfiles(
      this.preferences.get<unknown>(SPEXR_CLAUDE_LAUNCH_PROFILES_PREFERENCE),
    );
  }

  /**
   * CLAUDE_CONFIG_DIR for the session. The session's own config dir wins (so the
   * CLI finds the conversation); otherwise fall back to the account SPEXR runs
   * the side agent under, so a wall session started with nothing picked lands on
   * the same identity as the rest of the IDE.
   */
  private resolveConfigDir(configDir: string): string {
    if (configDir.trim()) return configDir.trim();
    const account = resolveAccount(
      this.preferences.get<string>(SPEXR_CLAUDE_ACTIVE_PROFILE_PREFERENCE) ?? "",
      this.launchProfiles(),
    );
    return account === AMBIGUOUS_ACCOUNT ? "" : account.configDir.trim();
  }
}
