import { injectable } from "@theia/core/shared/inversify";
import { app, BrowserWindow, dialog, ipcMain, shell } from "@theia/core/electron-shared/electron";
import type * as HttpsModule from "node:https";
import type { ElectronMainApplicationContribution } from "@theia/core/lib/electron-main/electron-main-application";

const CHANNEL_SHOW_OPEN = "ShowOpenDialog";

/** Minimum window dimensions (px) that keep the multi-panel layout usable. */
const MIN_WINDOW_WIDTH = 1100;
const MIN_WINDOW_HEIGHT = 700;

interface SpexrOpenDialogOptions {
  readonly path?: string;
  readonly buttonLabel?: string;
  readonly filters?: { name: string; extensions: string[] }[];
  readonly title?: string;
  readonly maxWidth?: number;
  readonly modal?: boolean;
  readonly openFiles?: boolean;
  readonly openFolders?: boolean;
  readonly selectMany?: boolean;
}

/**
 * SPEXR main-process tweaks:
 *
 * 1. Opens DevTools on each window only when `SPEXR_DEVTOOLS=1` is set, so the
 *    console no longer pops up by default (e.g. in the new-project window).
 *
 * 2. Enforces a minimum window size so the multi-panel layout has room to render.
 *
 * 3. Overrides Theia's `ShowOpenDialog` IPC handler to add the macOS
 *    `createDirectory` property. Without it, Finder hides the "New Folder"
 *    button and users cannot create destination folders inline (folder picker
 *    flows for "New project" and "Create spec target").
 */
@injectable()
export class SpexrElectronMainContribution implements ElectronMainApplicationContribution {
  onStart(): void {
    if (process.env.SPEXR_DEVTOOLS === "1") this.openDevToolsOnLoad();
    this.enforceMinimumSize();
    app.whenReady().then(() => {
      this.overrideOpenDialogHandler();
      this.scheduleUpdateCheck();
    });
  }

  private scheduleUpdateCheck(): void {
    if (!app.isPackaged) return;
    // Delay so the main window is visible before any dialog appears.
    setTimeout(() => this.checkForUpdate(), 8000);
  }

  private checkForUpdate(): void {
    const https = require("https") as typeof HttpsModule;
    const currentVersion = app.getVersion();

    const req = https.get(
      {
        hostname: "api.github.com",
        path: "/repos/sondalab-ai/spexr-ide/releases/latest",
        headers: { "User-Agent": "SPEXR-Desktop" },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => { raw += chunk; });
        res.on("end", () => {
          try {
            const release = JSON.parse(raw) as unknown;
            if (typeof release !== "object" || release === null) return;
            const { tag_name } = release as Record<string, unknown>;
            if (typeof tag_name !== "string") return;
            const latest = tag_name.replace(/^v/, "");
            if (this.isNewerVersion(latest, currentVersion)) {
              // Construct URL locally — never pass html_url from API to shell.openExternal.
              const releaseUrl = `https://github.com/sondalab-ai/spexr-ide/releases/tag/v${latest}`;
              this.showUpdateDialog(latest, releaseUrl);
            }
          } catch {
            // ignore malformed response
          }
        });
      },
    );
    req.on("error", () => { /* silently ignore network errors */ });
  }

  private isNewerVersion(latest: string, current: string): boolean {
    const parse = (v: string): [number, number, number] => {
      const parts = v.split(".").map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };
    const [lM, lm, lp] = parse(latest);
    const [cM, cm, cp] = parse(current);
    if (lM !== cM) return lM > cM;
    if (lm !== cm) return lm > cm;
    return lp > cp;
  }

  private showUpdateDialog(version: string, url: string): void {
    dialog
      .showMessageBox({
        type: "info",
        title: "Update available",
        message: `SPEXR ${version} is available`,
        detail: "A new version is ready. Click Download to open the releases page.",
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) shell.openExternal(url);
      })
      .catch(() => { /* ignore */ });
  }

  private openDevToolsOnLoad(): void {
    app.on("browser-window-created", (_event, window) => {
      window.webContents.once("did-finish-load", () => {
        window.webContents.openDevTools({ mode: "right" });
      });
    });
  }

  private enforceMinimumSize(): void {
    app.on("browser-window-created", (_event, window) => {
      window.setMinimumSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT);
    });
  }

  private overrideOpenDialogHandler(): void {
    try {
      ipcMain.removeHandler(CHANNEL_SHOW_OPEN);
    } catch (err) {
      console.warn("[spexr] could not remove default ShowOpenDialog handler", err);
    }
    ipcMain.handle(
      CHANNEL_SHOW_OPEN,
      async (event, options: SpexrOpenDialogOptions): Promise<string[]> => {
        const dialogOpts: Electron.OpenDialogOptions = {
          properties: this.toProperties(options),
        };
        if (options.path !== undefined) dialogOpts.defaultPath = options.path;
        if (options.buttonLabel !== undefined) dialogOpts.buttonLabel = options.buttonLabel;
        if (options.filters !== undefined) dialogOpts.filters = options.filters;
        if (options.title !== undefined) dialogOpts.title = options.title;
        if (options.modal) {
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win) {
            const result = await dialog.showOpenDialog(win, dialogOpts);
            return result.filePaths;
          }
        }
        const result = await dialog.showOpenDialog(dialogOpts);
        return result.filePaths;
      },
    );
  }

  private toProperties(options: SpexrOpenDialogOptions): Array<
    | "openFile"
    | "openDirectory"
    | "multiSelections"
    | "createDirectory"
    | "showHiddenFiles"
  > {
    const properties: Array<
      | "openFile"
      | "openDirectory"
      | "multiSelections"
      | "createDirectory"
      | "showHiddenFiles"
    > = [];
    if (options.openFiles) properties.push("openFile");
    if (options.openFolders) {
      properties.push("openDirectory");
      properties.push("createDirectory");
    }
    if (options.selectMany === true) properties.push("multiSelections");
    return properties;
  }
}
