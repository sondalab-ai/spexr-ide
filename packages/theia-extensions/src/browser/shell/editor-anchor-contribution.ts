import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import { trackEditorAnchor } from "./editor-anchor.js";
import { islandNodes } from "./islands.js";

/**
 * Publishes the editor island's place as `--spexr-editor-*` on the document
 * root (shell/editor-anchor.ts), for the palette and the toasts. Runs from
 * the shell's island nodes, so it needs {@link SpexrApplicationShell}; on the
 * stock shell the islands do not exist and the CSS keeps its window-wide
 * fallbacks.
 */
@injectable()
export class SpexrEditorAnchorContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  onStart(): void {
    const islands = islandNodes(this.shell);
    const main = islands.get("main") as HTMLElement | undefined;
    if (!main) return;
    const sides = (["left", "right"] as const).flatMap((area) => {
      const node = islands.get(area) as HTMLElement | undefined;
      return node ? [node] : [];
    });
    trackEditorAnchor(main.ownerDocument.documentElement, main, sides);
  }
}
