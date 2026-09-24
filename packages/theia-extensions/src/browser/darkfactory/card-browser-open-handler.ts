import { inject, injectable } from "@theia/core/shared/inversify";
import type URI from "@theia/core/lib/common/uri";
import type { OpenHandler } from "@theia/core/lib/browser/opener-service";
import { WidgetManager } from "@theia/core/lib/browser/widget-manager";
import { DARKFACTORY_VIEW_ID } from "./darkfactory-view-id.js";
import { cardKeyForLinkClick } from "./card-link-target.js";
import type { SpexrDarkfactoryWidget } from "./darkfactory-wall-widget.js";

/** Above Theia's HttpOpenHandler (500), which sends web links to the system browser. */
const PRIORITY = 1000;

/**
 * Opens a web link clicked in a pinned card's terminal in that card's browser
 * (spec 0016, slice 4). It only claims a link while focus is inside a card's
 * embedded terminal — which is where a terminal link click leaves it — so
 * every other web link keeps opening in the system browser.
 */
@injectable()
export class CardBrowserOpenHandler implements OpenHandler {
  readonly id = "spexr.darkfactory.card-browser";
  readonly label = "Card browser";

  @inject(WidgetManager) private readonly widgets!: WidgetManager;

  canHandle(uri: URI): number {
    if (uri.scheme !== "http" && uri.scheme !== "https") return 0;
    const key = cardKeyForLinkClick(document.activeElement);
    return key !== undefined && this.wall() !== undefined ? PRIORITY : 0;
  }

  open(uri: URI): object | undefined {
    const key = cardKeyForLinkClick(document.activeElement);
    const wall = this.wall();
    if (key === undefined || !wall?.openInCardBrowser(key, uri.toString(true))) {
      throw new Error(`No card to open ${uri.toString(true)} in`);
    }
    return wall;
  }

  private wall(): SpexrDarkfactoryWidget | undefined {
    return this.widgets.tryGetWidget<SpexrDarkfactoryWidget>(DARKFACTORY_VIEW_ID);
  }
}
