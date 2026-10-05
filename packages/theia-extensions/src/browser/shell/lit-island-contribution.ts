import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import { islandNodes, markLit, toIslandArea } from "./islands.js";

/**
 * Lights the island that holds the focus: sets `data-lit` on the area of the
 * shell's active widget, falling back to the current (last focused) one so
 * the light stays put while the focus is in a menu, a dialog or the quick
 * pick. One island at a time; none while no widget has been focused.
 *
 * Follows the shell's own focus tracking (`onDidChangeActiveWidget` /
 * `onDidChangeCurrentWidget`), never the DOM's. A tab whose widget takes no
 * focus (Darkfactory) therefore moves no light. Reads the islands through the
 * public shell API only, so it works on the stock `ApplicationShell` too.
 */
@injectable()
export class SpexrLitIslandContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  onStart(): void {
    const islands = islandNodes(this.shell);
    const update = (): void => {
      const widget = this.shell.activeWidget ?? this.shell.currentWidget;
      markLit(islands, toIslandArea(widget && this.shell.getAreaFor(widget)));
    };
    this.shell.onDidChangeActiveWidget(update);
    this.shell.onDidChangeCurrentWidget(update);
    update();
  }
}
