import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { SpexrGitScmProvider } from "./git-scm-provider.js";
import { GitCommands } from "./git-commands-contribution.js";
import { formatBranchEntry } from "./git-status-bar-format.js";

const ENTRY_ID = "spexr-git-branch";

/** Current branch and divergence from upstream; click opens the checkout picker. */
@injectable()
export class GitStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrGitScmProvider) private readonly provider!: SpexrGitScmProvider;

  onStart(): void {
    this.provider.onDidChangeStatus((s) => {
      void this.statusBar.setElement(ENTRY_ID, {
        text: formatBranchEntry(s),
        alignment: StatusBarAlignment.LEFT,
        priority: 200,
        tooltip: s.upstream ? `Tracking ${s.upstream}` : "No upstream branch",
        command: GitCommands.CHECKOUT.id,
      });
    });
  }
}
