import { inject, injectable } from "@theia/core/shared/inversify";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { FirstLaunchSizing } from "./workbench-geometry.js";

/**
 * Lumen's island sizes on a first launch: the Explorer 264px, the right
 * panel 352px, the bottom panel 204px (workbench-geometry.ts). Never on a
 * restored layout: Theia calls `initializeLayout` only when it had none to
 * restore.
 *
 * Bound after SpexrBootstrapContribution, so it runs after the agent
 * terminal's reveal and its floor (ClaudeTerminalManager awaits that resize):
 * the first launch's sizes are the last ones set.
 */
@injectable()
export class SpexrFirstLaunchLayoutContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  private readonly sizing = new FirstLaunchSizing();

  initializeLayout(): void {
    this.sizing.markDefaultLayout();
  }

  async onDidInitializeLayout(): Promise<void> {
    try {
      await this.sizing.apply(this.shell);
    } catch (err) {
      console.warn("[spexr] first-launch sizes failed", err);
    }
  }
}
