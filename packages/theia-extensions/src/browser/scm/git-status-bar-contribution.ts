import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment, type StatusBarEntry } from "@theia/core/lib/browser/status-bar/status-bar";
import { SpexrGitScmRegistry } from "./git-scm-registry.js";
import { GitCommands } from "./git-commands-contribution.js";
import { applyGitEntries, planGitEntries } from "./git-status-bar-format.js";
import { STATUS_BRANCH, STATUS_DIVERGENCE } from "../shell/status-dock.js";

/**
 * Current branch and divergence from upstream; click opens the checkout picker.
 *
 * Shows the repository the SCM panel is showing, not a fixed one: in a
 * multi-root workspace the entry follows the repository picker, so the branch
 * on display always belongs to the repository the panel's actions act on.
 * Theia's own `scm.change-repository` entry sits beside it (priority 100 to
 * this one's 200) once there is more than one repository, naming which.
 */
@injectable()
export class GitStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrGitScmRegistry) private readonly registry!: SpexrGitScmRegistry;

  onStart(): void {
    this.registry.onDidChangeStatus(() => this.renderActive());
    this.registry.onDidChangeActive(() => this.renderActive());
    this.registry.onDidChangeProviders(() => this.renderActive());
    // The fetch's outcome is its own event: the status one also drives the decorations and the breadcrumb meta.
    this.registry.onDidChangeFetchState(() => this.renderActive());
    // Subscribing above misses a refresh that already happened before this
    // contribution started (order among FrontendApplicationContributions
    // isn't a contract worth depending on) — render the active repository's
    // last known status directly, if there is one.
    this.renderActive();
  }

  /**
   * The branch, its divergence and "synced" for the repository the panel shows.
   * A refresh failure clears the panel's status, and the entries go with it
   * instead of showing a status the panel no longer has. "synced" is a click
   * on Git: Fetch, which does not read the autofetch preference.
   */
  private renderActive(): void {
    const active = this.registry.active;
    applyGitEntries<StatusBarEntry>(this.statusBar, planGitEntries(active?.lastStatus, active?.fetchFailed ?? false), (id, parts) => ({
      text: parts.text,
      alignment: StatusBarAlignment.LEFT,
      tooltip: parts.tooltip,
      ...(parts.label ? { accessibilityInformation: { label: parts.label } } : {}),
      ...(id === "branch" ? { className: STATUS_BRANCH, priority: 200, command: GitCommands.CHECKOUT.id } : {}),
      ...(id === "divergence" ? { className: STATUS_DIVERGENCE, priority: 199, command: GitCommands.CHECKOUT.id } : {}),
      ...(id === "sync" ? { priority: 190, command: GitCommands.FETCH.id } : {}),
    }));
  }
}
