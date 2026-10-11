import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution, type OpenViewArguments } from "@theia/core/lib/browser";
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

  /**
   * The wall joins the main area's tab strip behind the editors (S6c, D8), so
   * a restore-time open ({ activate: false, reveal: true }, which every
   * registered default gets) attaches it without bringing it to the front: it
   * is a destination the user picks, not the first thing a window shows.
   * Opening it by its toggle or an explicit activate still raises it.
   */
  override async openView(args: Partial<OpenViewArguments> = {}): Promise<SpexrDarkfactoryWidget> {
    return super.openView(args.reveal && !args.activate ? { ...args, reveal: false } : args);
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
