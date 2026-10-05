import { release } from "node:os";
import { injectable } from "@theia/core/shared/inversify";
import { ipcMain, type BrowserWindow, type Event as ElectronEvent, type WebContents } from "@theia/core/electron-shared/electron";
import type { MaybePromise } from "@theia/core/lib/common/types";
import { CHANNEL_SET_ZOOM_LEVEL, type WindowEvent } from "@theia/core/lib/electron-common/electron-api";
import { TheiaRendererAPI } from "@theia/core/lib/electron-main/electron-api-main";
import { ElectronMainApplication } from "@theia/core/lib/electron-main/electron-main-application";
import type { TheiaBrowserWindowOptions } from "@theia/core/lib/electron-main/theia-electron-window";
import { darwinMajor, lightsGeometry, macWindowChrome } from "../common/mac-title-bar.js";
import { MacLights } from "./mac-lights.js";
import { hardenWebviewAttach, isWebUrl } from "./webview-policy.js";
import { applyTitleBarStyle, type TitleBarStore, type TitleBarStyle } from "./title-bar-style.js";

/**
 * Theia's main application with `<webview>` enabled for the Darkfactory card
 * browser (spec 0016), spexr's custom title bar as the default frame on
 * Windows and Linux, and the system's traffic lights inside spexr's bar on
 * macOS.
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
 * - On macOS a main window hides the system's title bar and keeps its traffic
 *   lights inside spexr's ({@link macWindowChrome}, for the running macOS),
 *   on the bar's centre at any zoom ({@link MacLights}), and tells its page
 *   when it enters or leaves full screen, where macOS hides the lights.
 *   Secondary windows (a view moved out of the main window) keep the
 *   system's title bar: Theia builds their options without the defaults
 *   below and forces their frame, because they have no title bar of their own.
 */
@injectable()
export class SpexrElectronMainApplication extends ElectronMainApplication {
  private readonly macLights = new MacLights(lightsGeometry(darwinMajor(release())));

  /**
   * Theia's defaults, which every main window starts from (a new window and
   * the restored one: the stored state holds bounds and the frame, never a
   * title bar style), plus the webview tag and macOS's inset traffic lights.
   */
  protected override getDefaultOptions(): TheiaBrowserWindowOptions {
    const options = super.getDefaultOptions();
    return { ...options, ...macWindowChrome(process.platform, release()), webPreferences: { ...options.webPreferences, webviewTag: true } };
  }

  /**
   * Theia's window; on macOS its lights are kept on the bar and its
   * full-screen transitions reach its page, through Theia's window-event
   * channel: Theia's preload passes any name through to the page's
   * onWindowEvent, though its type lists only its own three.
   */
  override async createWindow(asyncOptions?: MaybePromise<TheiaBrowserWindowOptions>): Promise<BrowserWindow> {
    const window = await super.createWindow(asyncOptions);
    if (process.platform === "darwin") {
      this.macLights.add(window, (event) => TheiaRendererAPI.sendWindowEvent(window.webContents, event as WindowEvent));
    }
    return window;
  }

  /**
   * Theia's application events, plus, on macOS, the lights following the
   * zoom. Every zoom change goes through Theia's SetZoomLevel channel
   * (window.zoomLevel → setZoomLevel → webContents.setZoomLevel in the main
   * process). This listener is added before Theia's, so it hears the level
   * before Theia applies it: a room that grows goes to the pages at once
   * (MacLights.prepareZoom), and the lights move, with the exact room, a
   * turn later, once Theia's synchronous handler has applied the level.
   */
  protected override hookApplicationEvents(): void {
    super.hookApplicationEvents();
    if (process.platform !== "darwin") return;
    ipcMain.on(CHANNEL_SET_ZOOM_LEVEL, (_event, level: unknown) => {
      if (typeof level === "number") this.macLights.prepareZoom(level);
      setTimeout(() => this.macLights.syncAll());
    });
  }

  /**
   * Theia's precedence with spexr's default, plus the one-time Linux migration
   * (applyTitleBarStyle): a native frame stored by Theia's old Linux default
   * leaves the store once, keyed by a flag in the same store. Theia calls this
   * once, in `start`, before the first window's options are read; a failed
   * store write is reported, never thrown.
   */
  protected override getTitleBarStyle(config: ElectronMainApplication["config"]): TitleBarStyle {
    return applyTitleBarStyle(this.electronStore as unknown as TitleBarStore, {
      platform: process.platform,
      forceCustom: process.env.THEIA_ELECTRON_DISABLE_NATIVE_ELEMENTS === "1",
      configured: config.preferences?.["window.titleBarStyle"],
    });
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
