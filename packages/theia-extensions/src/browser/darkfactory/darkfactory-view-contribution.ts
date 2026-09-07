import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import type { Command, CommandRegistry } from "@theia/core/lib/common/command";
import type { SpexrDarkfactoryWidget } from "./darkfactory-wall-widget.js";
import { DARKFACTORY_VIEW_ID } from "./darkfactory-view-id.js";

export { DARKFACTORY_VIEW_ID };

/**
 * Rescan on demand. The backend both watches the config dirs and polls them, but
 * a session started outside SPEXR can still be a watcher event away from being
 * seen, so the wall keeps an explicit "look again now".
 */
export const DARKFACTORY_REFRESH_COMMAND: Command = {
  id: "spexr.darkfactory.refresh",
  category: "Darkfactory",
  label: "Refresh Sessions",
};

@injectable()
export class SpexrDarkfactoryViewContribution extends AbstractViewContribution<SpexrDarkfactoryWidget> {
  constructor() {
    super({
      widgetId: DARKFACTORY_VIEW_ID,
      widgetName: "Darkfactory",
      defaultWidgetOptions: { area: "main", rank: 3 },
      toggleCommandId: "spexr.view.darkfactory.toggle",
      toggleKeybinding: "ctrlcmd+shift+d",
    });
  }

  override registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);
    commands.registerCommand(DARKFACTORY_REFRESH_COMMAND, {
      // Only meaningful with the wall open: `tryGetWidget` avoids creating one
      // just to scan into a widget the user cannot see.
      isEnabled: () => !!this.tryGetWidget(),
      execute: () => this.tryGetWidget()?.refreshNow(),
    });
  }
}
