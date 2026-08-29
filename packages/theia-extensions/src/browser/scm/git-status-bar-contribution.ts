import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { SpexrGitScmProvider } from "./git-scm-provider.js";
import { GitCommands } from "./git-commands-contribution.js";
import { formatBranchEntry } from "./git-status-bar-format.js";
import type { GitStatusDto } from "../../common/git-protocol.js";

const ENTRY_ID = "spexr-git-branch";

/** Current branch and divergence from upstream; click opens the checkout picker. */
@injectable()
export class GitStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrGitScmProvider) private readonly provider!: SpexrGitScmProvider;

  onStart(): void {
    this.provider.onDidChangeStatus((s) => this.render(s));
    // Subscribing above misses a refresh that already happened before this
    // contribution started (order among FrontendApplicationContributions
    // isn't a contract worth depending on) — render the provider's last
    // known status directly, if it has one.
    if (this.provider.lastStatus) {
      this.render(this.provider.lastStatus);
    }
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
}
