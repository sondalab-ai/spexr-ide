import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const resolve = createRequire(import.meta.url).resolve;
const own = (file: string): string => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
const theiaMenu = readFileSync(resolve("@theia/core/lib/electron-browser/menu/electron-menu-contribution.js"), "utf8");
const theiaContextMenu = readFileSync(resolve("@theia/core/lib/electron-browser/menu/electron-context-menu-renderer.js"), "utf8");
const theiaMenuModule = readFileSync(resolve("@theia/core/lib/electron-browser/menu/electron-menu-module.js"), "utf8");
const theiaCommon = readFileSync(resolve("@theia/core/lib/browser/common-frontend-contribution.js"), "utf8");
const appPackage = readFileSync(resolve("@theia/application-package/lib/application-package.js"), "utf8");

/** The body of a method of Theia's ElectronMenuContribution, from its compiled source. */
function method(signature: string): string {
  const start = theiaMenu.indexOf(`\n    ${signature} {`);
  expect(start, `ElectronMenuContribution.${signature}`).toBeGreaterThanOrEqual(0);
  return theiaMenu.slice(start, theiaMenu.indexOf("\n    }\n", start));
}

describe("the Electron frontend module", () => {
  it("is its own theiaExtensions entry: Theia takes an entry's frontendElectron in place of its frontend", () => {
    expect(appPackage).toContain("const modulePath = extension[primary] || (secondary && extension[secondary]);");
    const entries = (JSON.parse(own("../../package.json")) as { theiaExtensions: Record<string, string>[] }).theiaExtensions;
    expect(entries.find((e) => e.frontend)).toEqual({ frontend: "lib/browser/index", electronMain: "lib/electron-main/index", backend: "lib/node/index" });
    expect(entries.find((e) => e.frontendElectron)).toEqual({ frontendElectron: "lib/electron-browser/index" });
  });

  it("rebinds Theia's menu contribution, which every service it backs resolves through", () => {
    expect(own("./spexr-electron-browser-module.ts")).toContain("rebind(ElectronMenuContribution).to(SpexrElectronMenuContribution).inSingletonScope();");
    for (const service of ["FrontendApplicationContribution", "KeybindingContribution", "CommandContribution", "MenuContribution"]) {
      expect(theiaMenuModule, service).toMatch(new RegExp(`\\b${service}\\b`));
    }
    expect(theiaMenuModule).toContain("bind(serviceIdentifier).toService(electron_menu_contribution_1.ElectronMenuContribution)");
  });

  it("defaults window.titleBarStyle to custom off macOS, so Theia's startup sync writes nothing", () => {
    const pref = own("./title-bar-preference-contribution.ts");
    expect(pref).toContain('if (!isOSX) service.registerOverride(PREF_WINDOW_TITLE_BAR_STYLE, undefined, "custom");');
    expect(own("./spexr-electron-browser-module.ts")).toContain("bind(PreferenceContribution).toService(SpexrTitleBarPreferenceContribution);");
  });
});

// SpexrElectronMenuContribution overrides four of Theia's hooks and relies on
// the rest; these fail if an upgrade moves what it relies on.
describe("Theia's Electron menu contribution, which spexr's subclass relies on", () => {
  it("hides the top panel first at start, then sets the menu once the startup style is known", () => {
    const styling = method("handleTitleBarStyling(app)");
    expect(styling.indexOf("this.hideTopPanel(app);")).toBeGreaterThanOrEqual(0);
    expect(styling.indexOf("this.hideTopPanel(app);")).toBeLessThan(styling.indexOf("this.titleBarStyle = style;"));
    expect(styling.indexOf("this.titleBarStyle = style;")).toBeLessThan(styling.indexOf("this.setMenu(app);"));
  });

  it("keeps the startup sync of window.titleBarStyle and the restart prompt", () => {
    const styling = method("handleTitleBarStyling(app)");
    expect(styling).toContain("this.preferenceService.inspect('window.titleBarStyle')");
    expect(styling).toContain("current?.defaultValue");
    expect(styling).toContain("window.electronTheiaCore.setTitleBarStyle(newTitleBarStyle);");
    expect(styling).toContain("this.handleRequiredRestart();");
  });

  it("builds its window controls with createControlButton and handleWindowControls", () => {
    const custom = method("createCustomTitleBar(app)");
    expect(custom).toContain("controls.id = 'window-controls';");
    for (const id of ["minimize", "maximize", "restore", "close"]) expect(custom, id).toContain(`this.createControlButton('${id}'`);
    expect(custom).toContain("this.handleWindowControls();");
  });

  it("hides the whole top panel in a custom window's full screen, which spexr's override stops", () => {
    expect(method("handleFullScreen(menuBarVisibility)")).toContain("this.shell.topPanel.hide();");
  });

  it("picks in-page context menus from the style the window started in", () => {
    expect(theiaContextMenu).toContain("await window.electronTheiaCore.getTitleBarStyleAtStartup() === 'native'");
  });
});

describe("spexr's Electron menu contribution", () => {
  const ours = own("./spexr-electron-menu-contribution.ts");

  it("never hides the top panel, and adds the title bar on every OS", () => {
    const hide = ours.slice(ours.indexOf("protected override hideTopPanel("), ours.indexOf("protected override setMenu("));
    expect(hide).toContain("this.addTitleBar(app);");
    expect(hide).not.toMatch(/hide\(\)|setHidden\(true\)/);
    expect(ours).toContain('app.shell.addWidget(this.titleBar, { area: "top" });');
  });

  it("adds window controls and the compact menu only in a custom window off macOS, the system's menus otherwise", () => {
    const setMenu = ours.slice(ours.indexOf("protected override setMenu("), ours.indexOf("protected isCustom("));
    expect(ours).toMatch(/protected isCustom\(\): boolean \{\s*return !isOSX && this\.titleBarStyle === "custom";/);
    expect(setMenu).toContain("const custom = this.isCustom();");
    expect(setMenu).toContain("this.titleBar.setMenuButton(custom);");
    expect(setMenu).toMatch(/if \(custom\) \{\s*this\.addWindowControls\(app\);\s*this\.dropSidebarMenu\(\);\s*this\.dropMenuBarToggle\(\);\s*return;\s*\}\s*this\.factory\.setMenuBar\(\);/);
  });

  // Theia's base setMenu was its only caller; spexr's setMenu adds the controls itself.
  it("leaves no override of createCustomTitleBar behind", () => {
    expect(ours).not.toMatch(/override createCustomTitleBar|this\.createCustomTitleBar\(/);
  });

  it("makes each of Theia's window controls a keyboard button", () => {
    expect(ours).toMatch(/protected override createControlButton\(id: string, handler: \(\) => void\): HTMLElement \{\s*const button = super\.createControlButton\(id, handler\);\s*keyboardButton\(button, WINDOW_CONTROL_LABELS\[id\] \?\? id, handler\);/);
    expect(method("createControlButton(id, handler)")).toContain("document.createElement('div')");
  });

  // It toggles window.menuBarVisibility, which a custom window ignores now.
  it("takes Toggle Menu Bar out in a custom window, through the registration Theia made", () => {
    expect(ours).toMatch(/protected dropMenuBarToggle\(\): void \{\s*this\.commandRegistry\.unregisterCommand\(CommonCommands\.SHOW_MENU_BAR\.id\);/);
    expect(theiaCommon).toContain("commandRegistry.registerCommand(common_commands_1.CommonCommands.SHOW_MENU_BAR, {");
    const commands = readFileSync(resolve("@theia/core/lib/browser/common-commands.js"), "utf8");
    expect(commands).toMatch(/SHOW_MENU_BAR = [^;]*id: 'window\.menuBarVisibility'/);
  });

  it("takes Theia's compact-mode sidebar menu out in a custom window, where the bar has the button", () => {
    expect(theiaCommon).toContain("const mainMenuId = 'main-menu';");
    expect(theiaCommon).toMatch(/if \(menuBarVisibility === 'compact'\) \{\s*this\.shell\.leftPanelHandler\.addTopMenu\(\{\s*id: mainMenuId,/);
    expect(ours).toContain('const THEIA_SIDEBAR_MENU_ID = "main-menu";');
    expect(ours).toMatch(/protected dropSidebarMenu\(\): void \{\s*if \(this\.isCustom\(\)\) this\.shell\.leftPanelHandler\.removeTopMenu\(THEIA_SIDEBAR_MENU_ID\);/);
    expect(ours).toMatch(/if \(e\.preferenceName === "window\.menuBarVisibility"\) setTimeout\(\(\) => this\.dropSidebarMenu\(\)\);/);
  });

  it("adds Theia's menu bar and title widget nowhere", () => {
    expect(ours).not.toMatch(/appendMenu|createCustomTitleWidget|customTitleWidgetFactory|theia-drag-panel/);
  });

  it("adds the bar and the controls once each: Theia sets the menu again on every macOS focus", () => {
    expect(ours).toMatch(/if \(this\.titleBarAdded\) return;\s*this\.titleBarAdded = true;/);
    expect(ours).toMatch(/if \(this\.windowControlsAdded\) return;\s*this\.windowControlsAdded = true;/);
  });
});
