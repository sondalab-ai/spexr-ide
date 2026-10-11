import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { SpexrGitScmRegistry } from "./git-scm-registry.js";
import { GitCommands } from "./git-commands-contribution.js";
import { formatBranchEntry, formatSyncEntry } from "./git-status-bar-format.js";
import type { GitStatusDto } from "../../common/git-protocol.js";
import { STATUS_BRANCH } from "../shell/status-dock.js";

const ENTRY_ID = "spexr-git-branch";
const SYNC_ENTRY_ID = "spexr-git-sync";

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
    // Subscribing above misses a refresh that already happened before this
    // contribution started (order among FrontendApplicationContributions
    // isn't a contract worth depending on) — render the active repository's
    // last known status directly, if there is one.
    this.renderActive();
  }

  private renderActive(): void {
    const active = this.registry.active;
    this.render(active?.lastStatus);
    this.renderSync(active?.lastStatus, active?.fetchFailed ?? false);
  }

  private render(s: GitStatusDto | undefined): void {
    if (!s) {
      // A refresh failure clears the panel's status; mirror that here
      // instead of leaving a stale branch/ahead-behind entry on display.
      this.statusBar.removeElement(ENTRY_ID);
      return;
    }
    void this.statusBar.setElement(ENTRY_ID, {
      text: formatBranchEntry(s),
      className: STATUS_BRANCH,
      alignment: StatusBarAlignment.LEFT,
      priority: 200,
      tooltip: s.mergeInProgress
        ? "Merge in progress — commit to conclude it"
        : s.upstream
          ? `Tracking ${s.upstream}`
          : "No upstream branch",
      command: GitCommands.CHECKOUT.id,
    });
  }

  /**
   * "synced" beside the branch (S6d, S3): the divergence and whether the last
   * fetch worked, and a click fetches (the command is Fetch's, which does not
   * read the autofetch preference, so it works with autofetch off).
   */
  private renderSync(s: GitStatusDto | undefined, fetchFailed: boolean): void {
    const entry = s ? formatSyncEntry({ upstream: s.upstream, behind: s.behind, fetchFailed }) : undefined;
    if (!entry) {
      this.statusBar.removeElement(SYNC_ENTRY_ID);
      return;
    }
    void this.statusBar.setElement(SYNC_ENTRY_ID, {
      text: entry.text,
      alignment: StatusBarAlignment.LEFT,
      priority: 190,
      tooltip: entry.tooltip,
      accessibilityInformation: { label: entry.label },
      command: GitCommands.FETCH.id,
    });
  }
}
