import { injectable } from "@theia/core/shared/inversify";
import { OutlineViewContribution } from "@theia/outline-view/lib/browser/outline-view-contribution";

/**
 * Theia's Outline, no longer opened by the default layout: the right island
 * starts with the agent pane (rank 0) and the views behind it, and the
 * Outline stays a command and a tile away for whoever wants it. Everything
 * else about the view is Theia's own; a layout that already holds it keeps it.
 */
@injectable()
export class SpexrOutlineViewContribution extends OutlineViewContribution {
  override async initializeLayout(): Promise<void> {
    // Intentionally not opened: see the class comment.
  }
}
