/**
 * The keyboard's way to the compact menu button's menus (Windows and Linux,
 * custom title bar), registered by SpexrElectronMenuContribution. Kept free of
 * Theia so its tests run in plain node.
 */
export const OPEN_APPLICATION_MENU_COMMAND = {
  id: "spexr.titlebar.openMenu",
  category: "View",
  label: "Open Application Menu",
} as const;

/**
 * Alt+Shift+M ("menu"). Free in Theia 1.75's own bindings, Monaco's, spexr's
 * and the bundled VS Code builtins (application-menu-command.test.ts checks
 * the first three). F10 is Debug: Step Over; Alt+F10 toggles maximisation in
 * GNOME; Ctrl+Alt+<letter> is AltGr on many layouts.
 */
export const OPEN_APPLICATION_MENU_KEYS = "alt+shift+m";
