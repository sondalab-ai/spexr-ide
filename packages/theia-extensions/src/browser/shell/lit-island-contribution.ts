import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import { islandNodes, trackLitIsland } from "./islands.js";

/**
 * Lights the island that holds the focus: sets `data-lit` on the area of the
 * shell's active widget, falling back to the current (last focused) one so
 * the light stays put while the focus is in a menu, a dialog or the quick
 * pick. One island at a time; none while no widget has been focused. The
 * logic is {@link trackLitIsland} (islands.ts), tested with a fake shell.
 *
 * Follows the shell's own focus tracking (`onDidChangeActiveWidget` /
 * `onDidChangeCurrentWidget`), never the DOM's, so a widget must take the
 * focus on activation to be lit (the Darkfactory wall does). Reads the
 * islands through the public shell API only, so it works on the stock
 * `ApplicationShell` too.
 */
@injectable()
export class SpexrLitIslandContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  onStart(): void {
    trackLitIsland(this.shell, islandNodes(this.shell));
  }
}
