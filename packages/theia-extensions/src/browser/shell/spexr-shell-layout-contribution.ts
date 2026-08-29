import { injectable, inject, multiInject, optional } from "@theia/core/shared/inversify";
import { ApplicationShell } from "@theia/core/lib/browser";
import type {
  FrontendApplication,
  FrontendApplicationContribution,
} from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { FileNavigatorContribution } from "@theia/navigator/lib/browser/navigator-contribution";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import { SpexrSpecViewContribution } from "../views/spec-view-contribution.js";
import { SpexrMemoryViewContribution } from "../views/memory-view-contribution.js";
import { SpexrExpertsViewContribution } from "../views/experts-view-contribution.js";
import { SpexrWelcomeViewContribution, WELCOME_VIEW_ID } from "../views/welcome-view-contribution.js";
import { SPEC_VIEW_ID } from "../views/spec-view-contribution.js";
import { CLAUDE_TERMINAL_ID } from "../agent/claude-terminal-manager.js";
import { expandLeftPanelWithMinWidth } from "./side-panel.js";
import { SpexrDarkfactorySidebarVisibilityContribution } from "../darkfactory/darkfactory-sidebar-visibility-contribution.js";
import { consumeProjectLanding } from "../project/project-landing-intent.js";
import { SpexrRevealOnRestore, type RevealOnRestoreView } from "./reveal-on-restore.js";

/** IDs of tabs pinned to positions 0, 1, 2 in the main area. */
const PINNED_IDS = [WELCOME_VIEW_ID, SPEC_VIEW_ID, CLAUDE_TERMINAL_ID] as const;

const TERMINAL_NEW_COMMAND = "terminal:new";

/**
 * Forces SPEXR's default layout on first launch.
 *
 * The Claude terminal is launched by `SpexrBootstrapContribution` and docks
 * itself into the left panel via `ClaudeTerminalManager`. Spec and memory views
 * live in the right side panel; welcome splash opens in the main area. Defaults
 * are applied only when the layout state is empty so user rearrangements survive
 * reload.
 */
@injectable()
export class SpexrShellLayoutContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(CommandService)
  private readonly commands!: CommandService;

  @inject(SpexrSpecViewContribution)
  private readonly specView!: SpexrSpecViewContribution;

  @inject(SpexrMemoryViewContribution)
  private readonly memoryView!: SpexrMemoryViewContribution;

  @inject(SpexrExpertsViewContribution)
  private readonly expertsView!: SpexrExpertsViewContribution;

  @inject(SpexrWelcomeViewContribution)
  @optional()
  private readonly welcomeView?: SpexrWelcomeViewContribution;

  @inject(FileNavigatorContribution)
  @optional()
  private readonly navigatorView?: FileNavigatorContribution;

  @multiInject(SpexrRevealOnRestore)
  private readonly revealOnRestore!: RevealOnRestoreView[];

  @inject(SpexrDarkfactorySidebarVisibilityContribution)
  private readonly darkfactorySidebar!: SpexrDarkfactorySidebarVisibilityContribution;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(TerminalService)
  @optional()
  private readonly terminalService?: TerminalService;

  onStart(app: FrontendApplication): void {
    void app;
    this.setupTabPinning();
  }

  /**
   * Runs after Theia's own shell-layout restore completes (`onStart` fires
   * too early — during "Start frontend contributions", before "Restoring the
   * layout state" — so `getLayoutData()` is always empty there; this was a
   * pre-existing latent bug, not specific to the reveal-on-restore registry).
   * This is the same hook `SpexrSmartSearchContribution` already uses correctly.
   *
   * `layoutAlreadyConfigured()` is a best-effort signal, not a reliable one:
   * Electron's `localStorage` (backing Theia's shell-layout cache) is not
   * workspace-scoped, so it can read "already configured" for a workspace
   * that has never actually been opened before (e.g. sequential e2e runs
   * against fresh temp dirs in the same Electron profile all share one
   * cached layout). Opening Spec/Memory/Experts/Navigator must therefore
   * NOT depend on that signal — `openView()` is idempotent, so it's safe to
   * call every launch regardless. Only the truly one-shot actions (spawning
   * a new terminal, auto-focusing Welcome) are gated on it.
   */
  async onDidInitializeLayout(): Promise<void> {
    try {
      const alreadyConfigured = this.layoutAlreadyConfigured();
      if (!alreadyConfigured) await this.openWelcome();
      await this.openSideViews();
      await this.revealRegisteredDefaults();
      if (!alreadyConfigured) await this.openTerminal();
      // A project switch has to land on a project tab: the restored layout, plus
      // the Darkfactory reveal above, would otherwise leave the dashboard in
      // front — the tab the user just navigated away from, and the one that
      // keeps the project sidebar collapsed. Read as late as possible: the
      // intent is consumed on read, so a throw above would otherwise burn it
      // and the next launch could not retry.
      if (await this.landedFromProjectSwitch()) await this.openWelcome();
      this.expandLeftPanel();
      await this.darkfactorySidebar.syncRightPanel(true);
    } catch (err) {
      console.error("[spexr] onDidInitializeLayout error", err);
    }
  }

  /**
   * Whether this launch is the tail of a project switch, and clear the intent.
   *
   * Switching project reloads the window, so the intent travels through
   * `localStorage`; it is honoured only when the root actually loaded is the one
   * the switch aimed at. See project-landing-intent.ts.
   */
  private async landedFromProjectSwitch(): Promise<boolean> {
    try {
      const roots = await this.workspace.roots;
      return consumeProjectLanding(localStorage, roots[0]?.resource.path.toString());
    } catch (err) {
      console.warn("[spexr] landing intent check failed", err);
      return false;
    }
  }

  /**
   * Reveal every view bound to `SpexrRevealOnRestore` — views added to the
   * defaults after the user's layout was first saved so they appear without a
   * manual layout reset. See reveal-on-restore.ts for why this is needed.
   */
  private async revealRegisteredDefaults(): Promise<void> {
    for (const view of this.revealOnRestore) {
      try {
        await view.openView({ activate: false, reveal: true });
      } catch (err) {
        console.warn("[spexr] revealRegisteredDefaults failed for a registered view", view.constructor?.name, err);
      }
    }
  }

  async resetLayout(): Promise<void> {
    const mainWidgets = this.shell.getWidgets("main");
    if (mainWidgets.length > 0) {
      await this.shell.closeMany(mainWidgets, { save: false });
    }
    await this.detachManagedViews();
    await this.applyDefaultLayout();
  }

  /**
   * `AbstractViewContribution.openView` does not relocate a widget that is
   * already attached, so a user-dragged Spec/Memory/Navigator panel stays in
   * its current dock until detached. Closing the views forces `applyDefaultLayout`
   * to re-add each widget at its `defaultWidgetOptions` area + rank.
   */
  private async detachManagedViews(): Promise<void> {
    await this.closeViewSafely(this.specView);
    await this.closeViewSafely(this.memoryView);
    await this.closeViewSafely(this.expertsView);
    if (this.welcomeView) await this.closeViewSafely(this.welcomeView);
    if (this.navigatorView) await this.closeViewSafely(this.navigatorView);
  }

  private async closeViewSafely(view: { closeView: () => Promise<unknown> }): Promise<void> {
    try {
      await view.closeView();
    } catch (err) {
      console.warn("[spexr] closeView failed during reset", err);
    }
  }

  private layoutAlreadyConfigured(): boolean {
    const data = this.shell.getLayoutData();
    return Boolean(data?.mainPanel?.main);
  }

  private async applyDefaultLayout(): Promise<void> {
    try {
      await this.openWelcome();
      await this.openSideViews();
      await this.openTerminal();
      this.expandLeftPanel();
      await this.darkfactorySidebar.syncRightPanel(true);
    } catch (err) {
      console.error("[spexr] applyDefaultLayout error", err);
    }
  }

  private async openWelcome(): Promise<void> {
    if (!this.welcomeView) return;
    await this.welcomeView.openView({ activate: true });
  }

  private async openSideViews(): Promise<void> {
    await this.openNavigator();
    await this.specView.openView({ activate: false, reveal: true });
    await this.memoryView.openView({ activate: false, reveal: true });
    await this.expertsView.openView({ activate: false, reveal: true });
  }

  private async openNavigator(): Promise<void> {
    if (!this.navigatorView) return;
    try {
      await this.navigatorView.openView({ activate: false, reveal: true });
    } catch (err) {
      console.warn("[spexr] navigator open failed", err);
    }
  }

  /**
   * Spawn the default bottom-panel terminal, unless one is already there.
   *
   * `layoutAlreadyConfigured()` inspects the *main* panel only, so a launch that
   * restores a bottom-panel terminal while the main area is empty reads as
   * unconfigured — and without this guard the restored terminal is joined by a
   * second, freshly spawned one.
   */
  private async openTerminal(): Promise<void> {
    if (this.hasBottomTerminal()) return;
    try {
      await this.commands.executeCommand(TERMINAL_NEW_COMMAND);
    } catch {
      // Terminal extension may be unavailable in some packages; ignore.
    }
  }

  /**
   * Whether a terminal is already docked in the bottom panel. Membership is
   * tested against that panel rather than by id, so neither the agent terminal
   * (left panel) nor Darkfactory's embedded resume terminals (attached outside
   * the shell) count as one.
   */
  private hasBottomTerminal(): boolean {
    if (!this.terminalService) return false;
    const bottom = new Set(this.shell.getWidgets("bottom").map((w) => w.id));
    return this.terminalService.all.some((t) => bottom.has(t.id));
  }

  private expandLeftPanel(): void {
    expandLeftPanelWithMinWidth(this.shell);
  }

  /**
   * Enforce Welcome → Specs → Agent order in every main-area tab bar.
   * Called on startup and whenever a widget is added to the shell so that
   * newly opened editors or views never push the pinned tabs out of positions 0–2.
   */
  private setupTabPinning(): void {
    // Run after any widget addition — area is not yet assigned when the event
    // fires, so we skip the area check and let enforcePinnedOrder guard itself.
    // setTimeout (macrotask) ensures Lumino has fully committed the insertion.
    this.shell.onDidAddWidget(() => {
      setTimeout(() => this.enforcePinnedOrder(), 0);
    });
  }

  private enforcePinnedOrder(): void {
    for (const tabBar of this.shell.mainAreaTabBars) {
      let insertIdx = 0;
      for (const id of PINNED_IDS) {
        const titles = tabBar.titles;
        const titleIdx = titles.findIndex((t) => t.owner.id === id);
        if (titleIdx < 0) continue;
        if (titleIdx !== insertIdx) {
          tabBar.insertTab(insertIdx, titles[titleIdx]!);
        }
        insertIdx++;
      }
    }
  }
}
