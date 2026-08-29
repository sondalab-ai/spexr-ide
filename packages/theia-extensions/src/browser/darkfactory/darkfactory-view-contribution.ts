import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import type { SpexrDarkfactoryWidget } from "./darkfactory-wall-widget.js";
import { DARKFACTORY_VIEW_ID } from "./darkfactory-view-id.js";

export { DARKFACTORY_VIEW_ID };

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
}
