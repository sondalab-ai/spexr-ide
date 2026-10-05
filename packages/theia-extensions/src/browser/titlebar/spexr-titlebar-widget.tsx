import * as React from "react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import type { Message } from "@theia/core/lib/browser/widgets/widget";
import { ApplicationShell } from "@theia/core/lib/browser/shell/application-shell";
import { ContextMenuRenderer } from "@theia/core/lib/browser/context-menu-renderer";
import { ContextKeyService } from "@theia/core/lib/browser/context-key-service";
import { KeybindingRegistry } from "@theia/core/lib/browser/keybinding";
import { CommonCommands } from "@theia/core/lib/browser/common-commands";
import { CommandService } from "@theia/core/lib/common/command";
import { Disposable } from "@theia/core/lib/common/disposable";
import { MAIN_MENU_BAR, MANAGE_MENU, type MenuPath } from "@theia/core/lib/common/menu";
import { isOSX, isWindows } from "@theia/core/lib/common/os";
import { EditorManager } from "@theia/editor/lib/browser";
import { NotificationManager } from "@theia/messages/lib/browser/notifications-manager";
import { NotificationsCommands } from "@theia/messages/lib/browser/notifications-commands";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { SpexrDarkfactoryServiceProxy, type SpexrDarkfactoryService } from "../darkfactory/darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "../darkfactory/darkfactory-client.js";
import { SpexrGitServiceProxySymbol } from "../scm/git-service-proxy.js";
import type { SpexrGitService } from "../../common/git-protocol.js";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { boundKeyCaps, keyPlatform } from "../views/key-caps.js";
import {
  agentsLabel,
  avatarLabel,
  bellLabel,
  crumbLabel,
  fieldKeys,
  initialMenuButton,
  initials,
  QUICK_OPEN_COMMAND,
  titleCrumb,
  type FieldKeys,
} from "./titlebar-model.js";
import { AgentsCount, type AgentsView } from "./agents-count.js";

/** Theia's right side panel, which the split button discloses. */
const RIGHT_PANEL_ID = "theia-right-content-panel";

/**
 * spexr's title bar: the kit's `.sl-titlebar` (workbench.css, 0.34) in
 * Theia's top panel, on every OS. SpexrElectronMenuContribution adds it and,
 * in a custom (frameless) window, puts Theia's window controls at its end.
 *
 * - `__menu`: the application menus as one compact button (Theia's compact
 *   mode does the same), only where the system draws no menu bar: a custom
 *   window on Windows or Linux.
 * - `__mark` and `__dot`: "spexr".
 * - `__crumb`: the workspace root, the active editor's folders, its file.
 * - `__cmd`: runs Quick Open, its keys read from the keybinding registry.
 * - `__r`: Dark Factory's running agents (hidden at 0, held as the wall
 *   holds them, see AgentsCount), the right panel's disclosure, the
 *   notification centre's bell (dotted while it holds any), and the git
 *   user's initials, which open Theia's Manage menu.
 *
 * Every interactive part is a `<button>`, which the kit takes out of the
 * window's drag region. `data-parity` names each part after its region in
 * tests/visual/reference/demo-regions.json.
 */
@injectable()
export class SpexrTitleBarWidget extends ReactWidget {
  static readonly ID = "spexr-titlebar";

  @inject(ApplicationShell) private readonly shell!: ApplicationShell;
  @inject(CommandService) private readonly commands!: CommandService;
  @inject(KeybindingRegistry) private readonly keybindings!: KeybindingRegistry;
  @inject(ContextMenuRenderer) private readonly contextMenu!: ContextMenuRenderer;
  @inject(ContextKeyService) private readonly contextKeys!: ContextKeyService;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(EditorManager) private readonly editors!: EditorManager;
  @inject(NotificationManager) private readonly notifications!: NotificationManager;
  @inject(SpexrDarkfactoryServiceProxy) private readonly darkfactory!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly darkfactoryClient!: SpexrDarkfactoryClientDispatcher;
  @inject(SpexrGitServiceProxySymbol) private readonly git!: SpexrGitService;

  /** The compact menu button: undefined (room kept, nothing drawn) until the window's style is known. */
  private menuButton = initialMenuButton(isOSX);
  private crumb: string[] = [];
  private crumbName = "";
  private keys: FieldKeys | undefined;
  private readonly agentsCount = new AgentsCount();
  private agents = 0;
  private holdTimer: ReturnType<typeof setTimeout> | undefined;
  private notificationCount = 0;
  private centerOpen = false;
  private rightOpen = false;
  private userName: string | undefined;

  constructor() {
    super();
    this.id = SpexrTitleBarWidget.ID;
    this.addClass("spexr-titlebar-host");
  }

  @postConstruct()
  protected init(): void {
    this.readKeys();
    this.toDispose.push(this.keybindings.onKeybindingsChanged(() => this.readKeys()));

    this.readCrumb();
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => {
      this.readCrumb();
      void this.readUserName();
    }));
    this.toDispose.push(this.editors.onCurrentEditorChanged(() => this.readCrumb()));
    void this.readUserName();

    this.toDispose.push(this.notifications.onUpdated((e) => {
      this.notificationCount = e.notifications.length;
      this.centerOpen = e.visibilityState === "center";
      this.update();
    }));

    this.toDispose.push(this.darkfactoryClient.onTilesChanged$((tiles) => this.showAgents(this.agentsCount.push(tiles, Date.now()))));
    void this.readTiles();
    // Dark Factory pushes reach only the newest window, so every other one
    // reads the last scan when it comes to the front.
    const onFocus = (): void => void this.readTiles();
    window.addEventListener("focus", onFocus);
    this.toDispose.push(Disposable.create(() => window.removeEventListener("focus", onFocus)));
    this.toDispose.push(Disposable.create(() => clearTimeout(this.holdTimer)));

    this.watchRightPanel();
    this.update();
  }

  /**
   * Theia registers its default key bindings in KeybindingRegistry.onStart,
   * after this widget exists, and fires no change event for them; the shell
   * attaches only once every contribution has started, so the keys are read
   * again here.
   */
  protected override onAfterAttach(msg: Message): void {
    super.onAfterAttach(msg);
    this.readKeys();
  }

  /** Whether the bar holds the compact menu button: a custom window on Windows or Linux. */
  setMenuButton(shown: boolean): void {
    if (this.menuButton === shown) return;
    this.menuButton = shown;
    this.update();
  }

  /** Whether the bar shows the compact menu button now. */
  hasMenuButton(): boolean {
    return this.menuButton === true;
  }

  /**
   * Open the application menus from the compact menu button, for the keyboard
   * (SpexrElectronMenuContribution's command). False when the bar has no
   * button: macOS, a native window, or before the window's style is known.
   */
  openApplicationMenu(): boolean {
    const button = this.node.querySelector<HTMLElement>(".sl-titlebar__menu");
    if (this.menuButton !== true || !button) return false;
    button.focus();
    this.openMenu(MAIN_MENU_BAR, button);
    return true;
  }

  private readKeys(): void {
    this.keys = fieldKeys(boundKeyCaps(this.keybindings, QUICK_OPEN_COMMAND, keyPlatform(isOSX, isWindows)));
    this.update();
  }

  private readCrumb(): void {
    const roots = this.workspace.tryGetRoots().map((r) => r.resource.path.toString());
    const file = this.editors.currentEditor?.editor.uri.path.toString();
    this.crumb = titleCrumb(roots, file);
    this.crumbName = crumbLabel(roots, file);
    this.update();
  }

  private async readUserName(): Promise<void> {
    const root = this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    try {
      this.userName = await this.git.getUserName(root);
    } catch {
      this.userName = undefined;
    }
    this.update();
  }

  /**
   * Read the backend's last scan (currentTiles: no scan, no side effects),
   * one read at a time; a push that lands meanwhile wins (AgentsCount).
   */
  private async readTiles(): Promise<void> {
    const token = this.agentsCount.startRead();
    if (token === undefined) return;
    let tiles: AgentTile[] | undefined;
    try {
      tiles = await this.darkfactory.currentTiles();
    } catch {
      // The backend is not up yet: the next push or focus reads again.
    }
    this.showAgents(this.agentsCount.finishRead(token, tiles, Date.now()));
  }

  /** Show a count, and look again when the earliest hold runs out, with no new scan. */
  private showAgents(view: AgentsView | undefined): void {
    if (!view) return;
    clearTimeout(this.holdTimer);
    this.holdTimer = undefined;
    if (view.nextExpiry !== undefined) {
      this.holdTimer = setTimeout(() => this.showAgents(this.agentsCount.expire(Date.now())), Math.max(0, view.nextExpiry - Date.now()));
    }
    if (this.agents === view.count) return;
    this.agents = view.count;
    this.update();
  }

  /**
   * The right panel's disclosure is expanded while the panel shows. Theia
   * sends no event for a side panel collapsing; its handler hides the dock
   * panel, on every path (the toggle, a drag to zero, Dark Factory's sidebar
   * policy).
   */
  private watchRightPanel(): void {
    const dock = this.shell.rightPanelHandler.dockPanel;
    const read = (): void => {
      const open = !dock.isHidden;
      if (open === this.rightOpen) return;
      this.rightOpen = open;
      this.update();
    };
    const observer = new MutationObserver(read);
    observer.observe(dock.node, { attributes: true, attributeFilter: ["class"] });
    this.toDispose.push(Disposable.create(() => observer.disconnect()));
    read();
  }

  /** A menu dropped from a title bar button, as Theia's sidebar menus open theirs. */
  private openMenu(menuPath: MenuPath, target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    this.contextMenu.render({
      menuPath,
      anchor: { x: rect.left, y: rect.bottom },
      context: target,
      contextKeyService: this.contextKeys,
      includeAnchorArg: false,
    });
  }

  private readonly onMenu = (e: React.MouseEvent<HTMLElement>): void => this.openMenu(MAIN_MENU_BAR, e.currentTarget);
  private readonly onManage = (e: React.MouseEvent<HTMLElement>): void => this.openMenu(MANAGE_MENU, e.currentTarget);
  private readonly onQuickOpen = (): void => void this.commands.executeCommand(QUICK_OPEN_COMMAND);
  private readonly onRightPanel = (): void => void this.commands.executeCommand(CommonCommands.TOGGLE_RIGHT_PANEL.id);
  private readonly onBell = (): void => void this.commands.executeCommand(NotificationsCommands.TOGGLE.id);

  protected render(): React.ReactNode {
    const agents = agentsLabel(this.agents);
    const bell = bellLabel(this.notificationCount);
    const monogram = initials(this.userName);
    return (
      <header className="sl-titlebar" data-parity="title">
        <div className="sl-titlebar__l" data-parity="title.left">
          {this.menuButton !== false && (
            <button
              type="button"
              className={`sl-icon-btn sl-titlebar__btn sl-titlebar__menu${this.menuButton === undefined ? " spexr-titlebar__menu--pending" : ""}`}
              aria-label="Application menu"
              aria-haspopup="menu"
              title="Application menu"
              onClick={this.onMenu}
              data-parity="title.menu"
            >
              <span className="codicon codicon-menu" aria-hidden="true" />
            </button>
          )}
          <span className="sl-titlebar__mark" data-parity="title.mark">
            spexr<span className="sl-titlebar__dot" aria-hidden="true" />
          </span>
          {this.crumb.length > 0 && (
            <span className="sl-titlebar__crumb" data-parity="title.crumb">
              <span aria-hidden="true">
                {this.crumb.map((part, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && (
                      <span className="sl-titlebar__sep" data-parity="title.crumb.sep">
                        /
                      </span>
                    )}
                    {part}
                  </React.Fragment>
                ))}
              </span>
              <span className="spexr-sr-only">{this.crumbName}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          className="sl-titlebar__cmd"
          aria-keyshortcuts={this.keys?.aria}
          onClick={this.onQuickOpen}
          data-parity="title.cmd"
        >
          <span className="codicon codicon-search" aria-hidden="true" data-parity="title.cmd.icon" />
          <span className="sl-titlebar__cmd-text" data-parity="title.cmd.text">
            Search files, run a command
          </span>
          {this.keys && (
            <span className="sl-titlebar__keys" aria-hidden="true" data-parity="title.cmd.keys">
              {this.keys.caps.map((cap, i) => (
                <kbd key={i} className="sl-kbd" data-parity="title.cmd.kbd">
                  {cap}
                </kbd>
              ))}
            </span>
          )}
        </button>
        <div className="sl-titlebar__r" data-parity="title.right">
          {agents && (
            <span className="sl-badge sl-badge--info sl-badge--live" data-parity="title.agents">
              {agents}
            </span>
          )}
          <button
            type="button"
            className="sl-icon-btn sl-titlebar__btn"
            aria-label="Right panel"
            aria-expanded={this.rightOpen}
            aria-controls={RIGHT_PANEL_ID}
            title="Toggle the right panel"
            onClick={this.onRightPanel}
            data-parity="title.split"
          >
            <span className="codicon codicon-layout-sidebar-right" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`sl-icon-btn sl-titlebar__btn${this.notificationCount > 0 ? " sl-titlebar__btn--dot" : ""}`}
            aria-label={bell}
            aria-expanded={this.centerOpen}
            title={bell}
            onClick={this.onBell}
            data-parity="title.bell"
          >
            <span className="codicon codicon-bell" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sl-icon-btn sl-avatar sl-avatar--sm spexr-titlebar__avatar"
            aria-label={avatarLabel(monogram)}
            aria-haspopup="menu"
            title={this.userName ? `${this.userName}: Manage` : "Manage"}
            onClick={this.onManage}
            data-parity="title.avatar"
          >
            {monogram ? <span>{monogram}</span> : <span className="codicon codicon-account" aria-hidden="true" />}
          </button>
        </div>
      </header>
    );
  }
}
