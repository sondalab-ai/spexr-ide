import { inject, injectable } from "@theia/core/shared/inversify";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { CLAUDE_TERMINAL_ID } from "../agent/claude-terminal-manager.js";
import { keepAgentFloor } from "./side-panel.js";
import { FirstLaunchSizing } from "./workbench-geometry.js";

/**
 * Lumen's island sizes on a first launch: the Explorer 264px, the right
 * panel 352px, the bottom panel 204px (workbench-geometry.ts). Never on a
 * restored layout: Theia calls `initializeLayout` only when it had none to
 * restore.
 *
 * Bound after SpexrBootstrapContribution, so it runs after the agent
 * terminal's reveal and its floor (ClaudeTerminalManager awaits that resize):
 * the first launch's sizes are the last ones set. The 264px left island is
 * the Explorer's: when the agent terminal is the left view in front, its
 * 432px floor is applied again after the sizes (parity decision, 2026-10-06), so a new
 * user never meets a 33-column agent.
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
      if (await this.sizing.apply(this.shell)) await keepAgentFloor(this.shell, CLAUDE_TERMINAL_ID);
    } catch (err) {
      console.warn("[spexr] first-launch sizes failed", err);
    }
  }
}
