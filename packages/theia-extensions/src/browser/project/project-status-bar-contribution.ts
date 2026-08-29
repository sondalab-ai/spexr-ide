import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { SpexrCommands } from "../commands/spexr-commands-contribution.js";

const ENTRY_ID = "spexr-project";

/** Last path segment, without importing node:path into the browser bundle. */
function baseName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/**
 * The loaded project, leftmost in the status bar; click switches project.
 *
 * The window title is the only other place that names it, and it is easy to
 * lose track of on a project-agnostic tab like Darkfactory. Sits at a higher
 * priority than the git branch entry so the project reads before its branch.
 */
@injectable()
export class SpexrProjectStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;

  onStart(): void {
    this.workspace.onWorkspaceChanged(() => this.render());
    this.render();
  }

  private render(): void {
    const root = this.workspace.tryGetRoots()[0]?.resource;
    const path = root?.path.toString();
    void this.statusBar.setElement(ENTRY_ID, {
      text: path ? `$(folder) ${baseName(path)}` : "$(folder) No project",
      alignment: StatusBarAlignment.LEFT,
      priority: 300,
      tooltip: path ? `${path} — click to switch project` : "Click to open a project",
      command: SpexrCommands.SWITCH_PROJECT.id,
    });
  }
}
