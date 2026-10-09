import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplication } from "@theia/core/lib/browser/frontend-application";
import type { KeybindingRegistry } from "@theia/core/lib/browser/keybinding";
import { CommandRegistry } from "@theia/core/lib/common/command";
import { CommonCommands } from "@theia/core/lib/browser/common-commands";
import { isOSX } from "@theia/core/lib/common/os";
import { ElectronMenuContribution } from "@theia/core/lib/electron-browser/menu/electron-menu-contribution";
import { SpexrTitleBarWidget } from "../browser/titlebar/spexr-titlebar-widget.js";
import { followFullScreen } from "../common/mac-title-bar.js";
import { OPEN_APPLICATION_MENU_COMMAND, OPEN_APPLICATION_MENU_KEYS } from "./application-menu-command.js";
import { keyboardButton, WINDOW_CONTROL_LABELS } from "./window-controls.js";

/** Theia's own compact-mode menu in the left sidebar (common-frontend-contribution.ts). */
const THEIA_SIDEBAR_MENU_ID = "main-menu";

/**
 * Theia's Electron menu contribution with spexr's title bar in the top panel
 * on every OS, in place of Theia's own custom title bar.
 *
 * Theia shows the top panel only in a custom (frameless) window on Windows or
 * Linux, and fills it with a drag strip, its logo, a menu bar, a centred
 * window title and the window controls. Here the panel always shows and holds
 * {@link SpexrTitleBarWidget}; a custom window adds Theia's window controls
 * (its own createControlButton, given a role, a name and the keyboard, and
 * handleWindowControls) at the bar's end, and the bar's compact menu button
 * stands in for the menu bar, with a command and Alt+Shift+M to open it from
 * the keyboard. A native window keeps the system's menus: macOS's menu bar,
 * Linux's escape hatch (`window.titleBarStyle: native`). On macOS the bar is the window's only
 * title bar, the system's traffic lights inside it (the main process's
 * window options), and it keeps their room except in full screen.
 * Everything else is Theia's, unchanged: the startup sync of
 * `window.titleBarStyle` with the style the window started in, and the
 * restart prompt when the setting changes.
 *
 * Theia calls setMenu again on every window focus on macOS, so the bar and
 * the controls are added once each, behind flags of their own: Theia's own
 * guard, `this.menuBar`, stays undefined because no menu bar widget is added.
 */
@injectable()
export class SpexrElectronMenuContribution extends ElectronMenuContribution {
  @inject(SpexrTitleBarWidget) protected readonly titleBar!: SpexrTitleBarWidget;
  @inject(CommandRegistry) protected readonly commandRegistry!: CommandRegistry;

  protected titleBarAdded = false;
  protected windowControlsAdded = false;

  override onStart(app: FrontendApplication): void {
    super.onStart(app);
    this.watchFullScreen();
  }

  /**
   * macOS: the bar's room for the traffic lights follows full screen
   * (followFullScreen). Theia has no full-screen event, and its
   * handleFullScreen reads the state right after asking for a change, before
   * macOS has made it, and never hears of the green button or the system
   * menu. The main process sends Electron's own events instead, once each
   * transition has finished. The state is also read once, defensively: Theia
   * never reopens a window in full screen, but a reload, or a transition that
   * ends while the page starts, would otherwise go unseen.
   */
  protected watchFullScreen(): void {
    followFullScreen(isOSX, window.electronTheiaCore, (lights) => this.titleBar.setTrafficLights(lights));
  }

  /** Never hides the top panel: it is spexr's title bar in either style. Theia calls this first, at start. */
  protected override hideTopPanel(app: FrontendApplication): void {
    this.addTitleBar(app);
  }

  protected override setMenu(app: FrontendApplication): void {
    this.addTitleBar(app);
    const custom = this.isCustom();
    this.titleBar.setMenuButton(custom);
    if (custom) {
      this.addWindowControls(app);
      this.dropSidebarMenu();
      this.dropMenuBarToggle();
      return;
    }
    this.factory.setMenuBar();
  }

  /** Off macOS, in a custom window: the bar has the menu button and the window controls. */
  protected isCustom(): boolean {
    return !isOSX && this.titleBarStyle === "custom";
  }

  /**
   * `window.menuBarVisibility: compact` makes Theia add its own Application
   * Menu button to the left sidebar, beside the one the bar already has. In
   * a custom window it is taken out again, after Theia's own listener runs.
   */
  protected override attachMenuBarVisibilityListener(): void {
    super.attachMenuBarVisibilityListener();
    this.preferenceService.onPreferenceChanged((e) => {
      if (e.preferenceName === "window.menuBarVisibility") setTimeout(() => this.dropSidebarMenu());
    });
  }

  protected dropSidebarMenu(): void {
    if (this.isCustom()) this.shell.leftPanelHandler.removeTopMenu(THEIA_SIDEBAR_MENU_ID);
  }

  /**
   * View > Appearance > Toggle Menu Bar switches window.menuBarVisibility
   * between compact and classic, and a custom window shows neither: the bar
   * always has its menu button. The command goes, with its menu item and its
   * palette entry; a native window keeps it, where it shows or hides the
   * system's menu bar.
   */
  protected dropMenuBarToggle(): void {
    this.commandRegistry.unregisterCommand(CommonCommands.SHOW_MENU_BAR.id);
  }

  /** Theia's control, made a keyboard button (see keyboardButton). */
  protected override createControlButton(id: string, handler: () => void): HTMLElement {
    const button = super.createControlButton(id, handler);
    keyboardButton(button, WINDOW_CONTROL_LABELS[id] ?? id, handler);
    return button;
  }

  override registerCommands(registry: CommandRegistry): void {
    super.registerCommands(registry);
    registry.registerCommand(OPEN_APPLICATION_MENU_COMMAND, {
      isEnabled: () => this.titleBar.hasMenuButton(),
      isVisible: () => this.titleBar.hasMenuButton(),
      execute: () => this.titleBar.openApplicationMenu(),
    });
  }

  override registerKeybindings(registry: KeybindingRegistry): void {
    super.registerKeybindings(registry);
    if (!isOSX) registry.registerKeybinding({ command: OPEN_APPLICATION_MENU_COMMAND.id, keybinding: OPEN_APPLICATION_MENU_KEYS });
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
