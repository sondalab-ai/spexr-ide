import { inject, injectable } from "@theia/core/shared/inversify";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { CLAUDE_TERMINAL_ID } from "../agent/claude-terminal-manager.js";
import { DefaultLayout } from "./workbench-geometry.js";

/** The body attribute the E2E suite and the capture wait on: the layout has settled. */
export const LAYOUT_READY_ATTRIBUTE = "data-spexr-layout-ready";

/**
 * spexr's default layout sizes and the layout's settled mark
 * (workbench-geometry.ts, `DefaultLayout`, holds the logic; this adapts it to
 * Theia).
 *
 * - `initializeLayout` runs only when Theia had no stored layout for the
 *   workspace. The sizes are decided there, once, before any panel shows:
 *   the Explorer 264px, or the agent terminal's 432px when a workspace is
 *   open (the bootstrap then reveals the agent terminal in front); the right
 *   panel 352px; the bottom panel 204px.
 * - `onDidInitializeLayout` is bound last of spexr's layout work, after the
 *   shell layout's views and the bootstrap's agent terminal, so the settled
 *   mark comes after every panel has its size.
 * - Reset Layout (SpexrShellLayoutContribution) applies the sizes again
 *   through `resetSizes`, the left island by the view then in front.
 */
@injectable()
export class SpexrDefaultLayoutContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  private readonly layout = new DefaultLayout({
    warn: (message, ...detail) => console.warn(message, ...detail),
    markSettled: () => document.body.setAttribute(LAYOUT_READY_ATTRIBUTE, "1"),
  });

  async initializeLayout(): Promise<void> {
    await this.workspace.ready;
    this.layout.seed(this.shell, this.workspace.opened);
  }

  onDidInitializeLayout(): Promise<void> {
    return this.layout.settle(this.shell);
  }

  /** Reset Layout's sizes: the default ones again, the left island the agent terminal's when it is in front. */
  resetSizes(): Promise<void> {
    return this.layout.reset(this.shell, this.shell.getCurrentWidget("left")?.id === CLAUDE_TERMINAL_ID);
  }
}
