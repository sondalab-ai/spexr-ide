import { inject, injectable } from "@theia/core/shared/inversify";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StorageService } from "@theia/core/lib/browser/storage-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { CLAUDE_TERMINAL_ID } from "../agent/claude-terminal-id.js";
import { DefaultLayout } from "./workbench-geometry.js";
import { LEFT_WIDTHS_STORAGE_KEY, LeftIslandWidth, type LeftPanelLike } from "./left-island-width.js";

/** The body attribute the E2E suite and the capture wait on: the layout has settled. */
export const LAYOUT_READY_ATTRIBUTE = "data-spexr-layout-ready";

/**
 * spexr's default layout sizes and the layout's settled mark
 * (workbench-geometry.ts, `DefaultLayout`, holds the logic; this adapts it to
 * Theia).
 *
 * - `initializeLayout` runs only when Theia had no stored layout for the
 *   workspace. The sizes are decided there, once, before the shell is ready
 *   (any panel already open is resized instantly):
 *   the Explorer 264px, or the agent terminal's 432px when a workspace is
 *   open (the bootstrap then reveals the agent terminal in front); the right
 *   panel 352px; the bottom panel 204px.
 * - `onDidInitializeLayout` is bound last in spexr's frontend module, after
 *   every contribution that touches the layout (the shell layout's views, the
 *   bootstrap's agent terminal, Smart Search in the Search view), so the
 *   settled mark comes after every panel and section has its size.
 * - Once the layout has settled, the left island's width starts following
 *   the view in front (left-island-width.ts, D2): 432px for the agent
 *   terminal, 264px for the Explorer, each remembered per view.
 * - Reset Layout (SpexrShellLayoutContribution) applies the sizes again
 *   through `resetSizes`, the left island by the view then in front, and
 *   forgets the remembered widths.
 */
@injectable()
export class SpexrDefaultLayoutContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(StorageService)
  private readonly storage!: StorageService;

  private leftWidth?: LeftIslandWidth;

  private readonly layout = new DefaultLayout({
    warn: (message, ...detail) => console.warn(message, ...detail),
    markSettled: () => document.body.setAttribute(LAYOUT_READY_ATTRIBUTE, "1"),
  });

  async initializeLayout(): Promise<void> {
    await this.workspace.ready;
    this.layout.seed(this.shell, this.workspace.opened);
  }

  async onDidInitializeLayout(): Promise<void> {
    await this.layout.settle(this.shell);
    const widths = this.leftWidths();
    window.addEventListener("beforeunload", () => widths.flush());
    await widths.attach();
  }

  /** Reset Layout's sizes: the default ones again, the left island the agent terminal's when it is in front. */
  async resetSizes(): Promise<void> {
    await this.leftWidths().clear();
    return this.layout.reset(this.shell, this.shell.getCurrentWidget("left")?.id === CLAUDE_TERMINAL_ID);
  }

  /** The left island's width memory, made on first use (the shell and storage are injected by then). */
  private leftWidths(): LeftIslandWidth {
    this.leftWidth ??= new LeftIslandWidth(
      this.shell.leftPanelHandler as unknown as LeftPanelLike,
      {
        load: () => this.storage.getData(LEFT_WIDTHS_STORAGE_KEY),
        save: (widths) => this.storage.setData(LEFT_WIDTHS_STORAGE_KEY, widths),
      },
      (message, ...detail) => console.warn(message, ...detail),
    );
    return this.leftWidth;
  }
}
