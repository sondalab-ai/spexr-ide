import { injectable, inject } from "@theia/core/shared/inversify";
import { DisposableCollection } from "@theia/core/lib/common/disposable";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import { trackEditorAnchor } from "./editor-anchor.js";
import { islandNodes } from "./islands.js";

/**
 * Publishes the editor island's place as `--spexr-editor-*` on the document
 * root (shell/editor-anchor.ts), for the palette and the toasts. It needs
 * {@link SpexrApplicationShell}'s islands; on the stock shell the main panel
 * is still there and the CSS keeps its window-wide fallbacks where the island
 * has no width. The side islands may not exist at `onStart`, so the tracking
 * is made again once the layout is initialised.
 */
@injectable()
export class SpexrEditorAnchorContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  private readonly tracking = new DisposableCollection();

  onStart(): void {
    this.track();
  }

  onDidInitializeLayout(): void {
    this.track();
  }

  onStop(): void {
    this.tracking.dispose();
  }

  /** (Re)start the tracking from the islands that exist now. */
  private track(): void {
    this.tracking.dispose();
    const islands = islandNodes(this.shell);
    const main = islands.get("main") as HTMLElement | undefined;
    const win = main?.ownerDocument.defaultView;
    if (!main || !win) return;
    const sides = (["left", "right"] as const).flatMap((area) => {
      const node = islands.get(area) as HTMLElement | undefined;
      return node ? [node] : [];
    });
    this.tracking.push(trackEditorAnchor(main.ownerDocument.documentElement, win, main, sides));
  }
}
