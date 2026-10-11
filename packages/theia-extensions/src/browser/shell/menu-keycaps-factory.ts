import { injectable } from "@theia/core/shared/inversify";
import { Menu } from "@theia/core/shared/@lumino/widgets";
import type { h } from "@theia/core/shared/@lumino/virtualdom";
import { ElectronMainMenuFactory } from "@theia/core/lib/electron-browser/menu/electron-main-menu-factory";
import type { BrowserMenuOptions, DynamicMenuWidget } from "@theia/core/lib/browser/menu/browser-menu-plugin";
import type { ContextMatcher } from "@theia/core/lib/browser/context-key-service";
import type { CompoundMenuNode, MenuPath } from "@theia/core/lib/common/menu";
import { formatShortcutCaps } from "./menu-keycaps.js";

/** Lumino's menu renderer, with each shortcut drawn as one kit keycap per key. */
export class KeycapMenuRenderer extends Menu.Renderer {
  override formatShortcut(data: Menu.IRenderData): h.Child {
    return formatShortcutCaps(data);
  }
}

/**
 * Theia's Electron menu factory, giving every browser menu it builds the
 * keycap renderer: the menu bar's menus with the custom title bar, context
 * menus, and their submenus, which Theia builds through createMenuWidget
 * with their parent's options. A menu given a renderer of its own keeps it.
 * Bound over ElectronMainMenuFactory, which BrowserMainMenuFactory resolves
 * to in Electron (Theia's electron-menu-module.ts).
 */
@injectable()
export class SpexrElectronMainMenuFactory extends ElectronMainMenuFactory {
  protected readonly keycapRenderer = new KeycapMenuRenderer();

  override createMenuWidget(
    parentPath: MenuPath,
    menu: CompoundMenuNode,
    contextMatcher: ContextMatcher,
    options: BrowserMenuOptions,
    args?: unknown[],
  ): DynamicMenuWidget {
    return super.createMenuWidget(parentPath, menu, contextMatcher, { ...options, renderer: options.renderer ?? this.keycapRenderer }, args);
  }
}
