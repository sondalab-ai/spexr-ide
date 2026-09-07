import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { TabBarToolbarRegistry } from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { MessageService } from "@theia/core/lib/common/message-service";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { PreferenceScope } from "@theia/core/lib/common/preferences/preference-scope";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import { SpexrLaunchProfilesService } from "../agent/launch-profiles-service.js";
import { describeAddedProfiles } from "../../common/claude-launch-profiles.js";
import { SPEXR_CLAUDE_LAUNCH_PROFILES_DETECTED_PREFERENCE } from "../preferences/spexr-preferences.js";

const TERMINAL_SPLIT_ITEM_ID = "terminal:split";

/**
 * Bootstraps spexr-specific behavior at frontend start.
 *
 * Removes the terminal "Split" toolbar action, then once the workspace is ready
 * delegates to `ClaudeTerminalManager` to launch the embedded Claude terminal
 * (profile resolution, context injection, and error surfacing live in the manager).
 *
 * Also cleans up stale temp workspace references: if the stored workspace is
 * under a system temp dir (e.g. leftover /tmp or /var/folders path from a past
 * e2e session), close it so the app starts on the welcome page.
 * Normal user workspaces and e2e workspaces under test-results/ are untouched.
 */
@injectable()
export class SpexrBootstrapContribution implements FrontendApplicationContribution {
  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(TabBarToolbarRegistry)
  private readonly toolbar!: TabBarToolbarRegistry;

  @inject(ClaudeTerminalManager)
  private readonly terminalManager!: ClaudeTerminalManager;

  @inject(SpexrLaunchProfilesService)
  private readonly launchProfiles!: SpexrLaunchProfilesService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  async onStart(): Promise<void> {
    await this.workspace.ready;
    const uri = this.workspace.workspace?.resource.toString() ?? "";
    if (uri && isSystemTempPath(uri)) {
      await this.workspace.close();
    }
  }

  async onDidInitializeLayout(): Promise<void> {
    this.toolbar.unregisterItem(TERMINAL_SPLIT_ITEM_ID);
    await this.workspace.ready;
    if (!this.workspace.opened) return;
    // Before the session starts: a profile found now decides how it launches,
    // and finding it afterwards would leave this first session on plain `claude`.
    await this.detectLaunchProfilesOnce();
    await this.terminalManager.ensureStarted();
  }

  /**
   * Look for launch profiles in the user's shell aliases, once ever, and say so.
   *
   * This writes to the user's settings without being asked, so it announces
   * what it added and where to change it. It runs a single time — recorded in
   * `spexr.claude.launchProfilesDetected` — so profiles someone deleted do not
   * come back on the next launch; the command re-runs it on demand.
   *
   * A failure leaves the flag unset so the next start retries, and stays quiet:
   * the user did not ask for this, so it is not worth an error popup.
   */
  private async detectLaunchProfilesOnce(): Promise<void> {
    if (this.preferences.get<boolean>(SPEXR_CLAUDE_LAUNCH_PROFILES_DETECTED_PREFERENCE)) return;
    try {
      const { added } = await this.launchProfiles.detect();
      await this.preferences.set(
        SPEXR_CLAUDE_LAUNCH_PROFILES_DETECTED_PREFERENCE,
        true,
        PreferenceScope.User,
      );
      if (added.length > 0) this.messages.info(describeAddedProfiles(added));
    } catch (err) {
      console.warn("[spexr] launch-profile detection failed", err);
    }
  }
}

function isSystemTempPath(uri: string): boolean {
  return /\/(private\/var\/folders|var\/folders|tmp)\//.test(uri);
}
