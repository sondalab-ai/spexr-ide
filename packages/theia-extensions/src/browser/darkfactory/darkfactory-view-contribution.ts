import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import { SpexrDarkfactoryWidget } from "./darkfactory-widget.js";

export const DARKFACTORY_VIEW_ID = SpexrDarkfactoryWidget.ID;

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
