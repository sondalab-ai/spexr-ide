import { injectable } from "@theia/core/shared/inversify";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import type {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { ScmWidget } from "@theia/scm/lib/browser/scm-widget";
import { GitCommands } from "./git-commands-contribution.js";

/**
 * Surfaces the core git actions (commit, commit & push, push, pull, fetch,
 * branch, refresh)
 * as icon buttons in the SCM panel title toolbar. Items are only visible when
 * the active view is the SCM widget.
 */
@injectable()
export class SpexrGitToolbarContribution implements TabBarToolbarContribution {
  registerToolbarItems(registry: TabBarToolbarRegistry): void {
    const items: { command: typeof GitCommands[keyof typeof GitCommands]; icon: string; tooltip: string }[] = [
      { command: GitCommands.COMMIT, icon: "codicon codicon-check", tooltip: "Commit" },
      {
        command: GitCommands.COMMIT_AND_PUSH,
        icon: "codicon codicon-check-all",
        tooltip: "Commit & Push",
      },
      { command: GitCommands.PUSH, icon: "codicon codicon-repo-push", tooltip: "Push" },
      { command: GitCommands.PULL, icon: "codicon codicon-repo-pull", tooltip: "Pull" },
      { command: GitCommands.FETCH, icon: "codicon codicon-sync", tooltip: "Fetch" },
      { command: GitCommands.CREATE_BRANCH, icon: "codicon codicon-git-branch", tooltip: "Create Branch" },
      { command: GitCommands.REFRESH, icon: "codicon codicon-refresh", tooltip: "Refresh" },
    ];
    items.forEach(({ command, icon, tooltip }, index) => {
      registry.registerItem({
        id: command.id,
        command: command.id,
        icon,
        tooltip,
        group: "navigation",
        priority: index,
        isVisible: (widget?: Widget) => widget?.id === ScmWidget.ID,
      });
    });
  }
}
