import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplication } from "@theia/core/lib/browser/frontend-application";
import { isOSX } from "@theia/core/lib/common/os";
import { ElectronMenuContribution } from "@theia/core/lib/electron-browser/menu/electron-menu-contribution";
import { SpexrTitleBarWidget } from "../browser/titlebar/spexr-titlebar-widget.js";

/**
 * Theia's Electron menu contribution with spexr's title bar in the top panel
 * on every OS, in place of Theia's own custom title bar.
 *
 * Theia shows the top panel only in a custom (frameless) window on Windows or
 * Linux, and fills it with a drag strip, its logo, a menu bar, a centred
 * window title and the window controls. Here the panel always shows and holds
 * {@link SpexrTitleBarWidget}; a custom window adds Theia's window controls
 * (its own createControlButton and handleWindowControls) at the bar's end and
 * the bar's compact menu button stands in for the menu bar. A native window
 * keeps the system's menus: macOS's menu bar, Linux's escape hatch
 * (`window.titleBarStyle: native`). Everything else is Theia's, unchanged:
 * the startup sync of `window.titleBarStyle` with the style the window
 * started in, and the restart prompt when the setting changes.
 *
 * Theia calls setMenu again on every window focus on macOS, so the bar and
 * the controls are added once each, behind flags of their own: Theia's own
 * guard, `this.menuBar`, stays undefined because no menu bar widget is added.
 */
@injectable()
export class SpexrElectronMenuContribution extends ElectronMenuContribution {
  @inject(SpexrTitleBarWidget) protected readonly titleBar!: SpexrTitleBarWidget;

  protected titleBarAdded = false;
  protected windowControlsAdded = false;

  /** Never hides the top panel: it is spexr's title bar in either style. Theia calls this first, at start. */
  protected override hideTopPanel(app: FrontendApplication): void {
    this.addTitleBar(app);
  }

  protected override setMenu(app: FrontendApplication): void {
    this.addTitleBar(app);
    const custom = !isOSX && this.titleBarStyle === "custom";
    this.titleBar.setMenuButton(custom);
    if (custom) {
      this.addWindowControls(app);
      return;
    }
    this.factory.setMenuBar();
  }

  /** Theia's custom title bar is replaced whole; only its window controls stay. */
  protected override createCustomTitleBar(app: FrontendApplication): void {
    this.addWindowControls(app);
  }

  /**
   * Full screen keeps the bar: in a custom window Theia hid the whole top
   * panel, which now holds the command field and the bell too. A native
   * window still shows or hides the system's menu bar, as Theia does.
   */
  protected override handleFullScreen(menuBarVisibility: string): void {
    if (this.titleBarStyle === "native") super.handleFullScreen(menuBarVisibility);
  }

  protected addTitleBar(app: FrontendApplication): void {
    app.shell.topPanel.show();
    if (this.titleBarAdded) return;
    this.titleBarAdded = true;
    app.shell.addWidget(this.titleBar, { area: "top" });
  }

  /** Theia's minimize, maximize, restore and close, as its createCustomTitleBar builds them. */
  protected addWindowControls(app: FrontendApplication): void {
    if (this.windowControlsAdded) return;
    this.windowControlsAdded = true;
    const controls = document.createElement("div");
    controls.id = "window-controls";
    controls.append(
      this.createControlButton("minimize", () => window.electronTheiaCore.minimize()),
      this.createControlButton("maximize", () => window.electronTheiaCore.maximize()),
      this.createControlButton("restore", () => window.electronTheiaCore.unMaximize()),
      this.createControlButton("close", () => window.electronTheiaCore.close()),
    );
    app.shell.topPanel.node.append(controls);
    this.handleWindowControls();
  }
}
