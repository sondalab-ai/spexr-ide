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
import { boundKeyCaps, keyPlatform } from "../views/key-caps.js";
import {
  agentsLabel,
  bellLabel,
  fieldKeys,
  initials,
  QUICK_OPEN_COMMAND,
  runningAgents,
  titleCrumb,
  type FieldKeys,
} from "./titlebar-model.js";

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
 * - `__r`: Dark Factory's running agents (hidden at 0), the right panel's
 *   toggle, the notification centre's bell (dotted while it holds any), and
 *   the git user's initials, which open Theia's Manage menu.
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

  /** Shown until the window turns out to have a native menu (macOS, or Linux's native escape hatch). */
  private menuButton = !isOSX;
  private crumb: string[] = [];
  private keys: FieldKeys | undefined;
  private agents = 0;
  private notificationCount = 0;
  private centerOpen = false;
  private rightOpen = false;
  private userName: string | undefined;
  private tilesInFlight = false;

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

    this.toDispose.push(this.darkfactoryClient.onTilesChanged$((tiles) => this.setAgents(runningAgents(tiles))));
    void this.readTiles();
    // Dark Factory pushes reach only the newest window, so every other one
    // re-reads when it comes to the front.
    const onFocus = (): void => void this.readTiles();
    window.addEventListener("focus", onFocus);
    this.toDispose.push(Disposable.create(() => window.removeEventListener("focus", onFocus)));

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

  private readKeys(): void {
    this.keys = fieldKeys(boundKeyCaps(this.keybindings, QUICK_OPEN_COMMAND, keyPlatform(isOSX, isWindows)));
    this.update();
  }

  private readCrumb(): void {
    const roots = this.workspace.tryGetRoots().map((r) => r.resource.path.toString());
    const file = this.editors.currentEditor?.editor.uri.path.toString();
    this.crumb = titleCrumb(roots, file);
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

  /** listTiles re-scans the transcripts, so a focus storm runs it once at a time. */
  private async readTiles(): Promise<void> {
    if (this.tilesInFlight) return;
    this.tilesInFlight = true;
    try {
      this.setAgents(runningAgents(await this.darkfactory.listTiles()));
    } catch {
      // The backend is not up yet, or the scan failed: the next push or focus reads again.
    } finally {
      this.tilesInFlight = false;
    }
  }

  private setAgents(count: number): void {
    if (this.agents === count) return;
    this.agents = count;
    this.update();
  }

  /**
   * The right panel's toggle is pressed while the panel shows. Theia sends no
   * event for a side panel collapsing; its handler hides the dock panel, on
   * every path (the toggle, a drag to zero, Dark Factory's sidebar policy).
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
    const manage = this.userName ? `Manage, ${this.userName}` : "Manage";
    return (
      <header className="sl-titlebar" data-parity="title">
        <div className="sl-titlebar__l" data-parity="title.left">
          {this.menuButton && (
            <button
              type="button"
              className="sl-icon-btn sl-titlebar__btn sl-titlebar__menu"
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
            <span className="sl-titlebar__crumb" title={this.crumb.join(" / ")} data-parity="title.crumb">
              {this.crumb.map((part, i) => (
                <React.Fragment key={i}>
                  {i > 0 && (
                    <span className="sl-titlebar__sep" aria-hidden="true" data-parity="title.crumb.sep">
                      /
                    </span>
                  )}
                  {part}
                </React.Fragment>
              ))}
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
            aria-pressed={this.rightOpen}
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
            aria-label={manage}
            aria-haspopup="menu"
            title={manage}
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
