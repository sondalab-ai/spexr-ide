import { injectable } from "@theia/core/shared/inversify";
import type { Event as ElectronEvent, WebContents } from "@theia/core/electron-shared/electron";
import { ElectronMainApplication } from "@theia/core/lib/electron-main/electron-main-application";
import type { TheiaBrowserWindowOptions } from "@theia/core/lib/electron-main/theia-electron-window";
import { hardenWebviewAttach, isWebUrl } from "./webview-policy.js";

/**
 * Theia's main application with `<webview>` enabled for the Darkfactory card
 * browser (spec 0016).
 *
 * - The tag is switched on by adding `webviewTag` to Theia's own default
 *   `webPreferences`; setting it through the application config would replace
 *   that whole object, dropping `contextIsolation` and the rest.
 * - Every guest is hardened before it attaches (see {@link hardenWebviewAttach}).
 * - Guests are exempt from Theia's app-wide navigation block, which cancels
 *   every in-page navigation: a guest may navigate between web pages, and a
 *   popup opens in the same guest. Every other web contents keeps Theia's
 *   policy.
 */
@injectable()
export class SpexrElectronMainApplication extends ElectronMainApplication {
  protected override getDefaultOptions(): TheiaBrowserWindowOptions {
    const options = super.getDefaultOptions();
    return { ...options, webPreferences: { ...options.webPreferences, webviewTag: true } };
  }

  protected override onWebContentsCreated(event: ElectronEvent, webContents: WebContents): void {
    if (webContents.getType() === "webview") {
      this.configureGuest(webContents);
      return;
    }
    super.onWebContentsCreated(event, webContents);
    webContents.on("will-attach-webview", (attachEvent, webPreferences, params) => {
      if (!hardenWebviewAttach(webPreferences as Record<string, unknown>, params)) {
        attachEvent.preventDefault();
      }
    });
  }

  private configureGuest(guest: WebContents): void {
    guest.on("will-navigate", (navigation) => {
      if (!isWebUrl(navigation.url)) navigation.preventDefault();
    });
    guest.on("will-redirect", (navigation) => {
      if (!isWebUrl(navigation.url)) navigation.preventDefault();
    });
    guest.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void guest.loadURL(url);
      return { action: "deny" };
    });
  }
}
