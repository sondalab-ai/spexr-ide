import { injectable } from "@theia/core/shared/inversify";
import type { Event as ElectronEvent, WebContents } from "@theia/core/electron-shared/electron";
import { ElectronMainApplication } from "@theia/core/lib/electron-main/electron-main-application";
import type { TheiaBrowserWindowOptions } from "@theia/core/lib/electron-main/theia-electron-window";
import { hardenWebviewAttach, isWebUrl } from "./webview-policy.js";
import { decideTitleBarStyle, TITLE_BAR_MIGRATION_KEY, type TitleBarStyle } from "./title-bar-style.js";

/** Theia's electron-store, keyed loosely so spexr's own flag can sit beside `windowstate`. */
interface FlagStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

/**
 * Theia's main application with `<webview>` enabled for the Darkfactory card
 * browser (spec 0016), and spexr's custom title bar as the default frame on
 * Windows and Linux.
 *
 * - The tag is switched on by adding `webviewTag` to Theia's own default
 *   `webPreferences`; setting it through the application config would replace
 *   that whole object, dropping `contextIsolation` and the rest.
 * - Every guest is hardened before it attaches (see {@link hardenWebviewAttach}).
 * - Guests are exempt from Theia's app-wide navigation block, which cancels
 *   every in-page navigation: a guest may navigate between web pages, and a
 *   popup opens in the same guest. Every other web contents keeps Theia's
 *   policy.
 * - The frame follows {@link decideTitleBarStyle}; the frontend's
 *   SpexrElectronMenuContribution draws spexr's title bar in either style.
 */
@injectable()
export class SpexrElectronMainApplication extends ElectronMainApplication {
  protected override getDefaultOptions(): TheiaBrowserWindowOptions {
    const options = super.getDefaultOptions();
    return { ...options, webPreferences: { ...options.webPreferences, webviewTag: true } };
  }

  /**
   * Theia's precedence with spexr's default, plus the one-time Linux migration:
   * a native frame stored by Theia's old Linux default leaves the store once,
   * keyed by a flag in the same store. Theia calls this once, in `start`,
   * before the first window's options are read.
   */
  protected override getTitleBarStyle(config: ElectronMainApplication["config"]): TitleBarStyle {
    const flags = this.electronStore as unknown as FlagStore;
    const windowState = this.electronStore.get("windowstate");
    const decision = decideTitleBarStyle({
      platform: process.platform,
      forceCustom: process.env.THEIA_ELECTRON_DISABLE_NATIVE_ELEMENTS === "1",
      storedFrame: windowState?.frame,
      migrated: flags.get(TITLE_BAR_MIGRATION_KEY) === true,
      configured: config.preferences?.["window.titleBarStyle"],
    });
    if (decision.dropStoredFrame && windowState) {
      const { frame: _dropped, ...rest } = windowState;
      this.electronStore.set("windowstate", rest);
    }
    if (decision.markMigrated) flags.set(TITLE_BAR_MIGRATION_KEY, true);
    return decision.style;
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
