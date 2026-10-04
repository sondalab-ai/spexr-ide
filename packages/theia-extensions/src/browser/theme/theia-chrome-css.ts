import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";
import { ACCENT_FILL } from "./spexr-accent.js";

/**
 * The CSS SpexrThemeContribution injects for a SPEXR theme: `--theia-*`
 * variable overrides that put Theia's native chrome (buttons, focus rings,
 * badges, lists, activity bar, status bar) on the SPEXR accent, its
 * registered fill, the SPEXR neutrals and the kit's selection tile, and the
 * kit's UI face (Geist) instead of the platform font. High contrast gets the
 * face only: its colours stay Theia's own HC theme and the kit's yellow.
 * Pure, so it can be rendered outside Theia.
 */
export function theiaChromeCss(spexrTheme: string): string {
  const font = `
/* Theia's chrome in the kit's UI face (Geist). On body too: Theia's os.css sets
   this variable on body.mac / .windows / .linux, which would shadow :root. The
   editor and terminal keep their own coding mono (editor.fontFamily). */
:root,
body {
  --theia-ui-font-family: var(--sl-font-sans) !important;
}`;
  if (spexrTheme === "high-contrast") return font;

  const isDark = spexrTheme === "dark";
  const accent        = isDark ? "#8b96ff" : "#5b6cff";
  const accentSubtle  = isDark ? "rgba(139,150,255,0.12)" : "rgba(91,108,255,0.1)";
  // The accent as text or a thin line: the kit's role, capped on light so it
  // reads at 4.5:1 (#5b6cff itself is 3.37:1 on the light canvas).
  const accentText    = "var(--slc-accent-text)";
  const onAccent      = "#ffffff";
  // A fill that carries the white label: the registered fill and its hover,
  // on both themes (the kit's --slc-accent-fill, spexr-overrides.css).
  const fill          = ACCENT_FILL;
  const fillHover     = `color-mix(in srgb, ${ACCENT_FILL} 89%, black)`;

  // Sondalab surface neutrals — pushed into Theia's native chrome so the
  // editor/sidebar/tabs/terminal share the same indigo-tinted greys as the
  // SPEXR-styled panels (the kit's generated spexr ladder), instead of
  // Theia's default neutral grey.
  const { canvas, surface, raised, fg, fgMuted, line } =
    SPEXR_NEUTRALS[isDark ? "dark" : "light"];

  const css = `
:root {
  /* Focus ring */
  --theia-focusBorder: ${accent} !important;

  /* Native buttons. Buttons, badges and the menu's selection carry a white
     label, so they take the registered fill (white 5.41:1, hovered 6.47),
     never the #5b6cff accent (4.17). */
  --theia-button-background: ${fill} !important;
  --theia-button-hoverBackground: ${fillHover} !important;
  --theia-button-foreground: ${onAccent} !important;
  --theia-button-secondaryForeground: ${accentText} !important;
  --theia-button-secondaryBackground: ${accentSubtle} !important;
  --theia-button-secondaryHoverBackground: ${accentSubtle} !important;

  /* Badges */
  --theia-badge-background: ${fill} !important;
  --theia-badge-foreground: ${onAccent} !important;

  /* Activity-bar badge + menu selection: baked into the theme JSON as #007ACC,
     so they beat ColorRegistry overrides — only !important reaches them. */
  --theia-activityBarBadge-background: ${fill} !important;
  --theia-activityBarBadge-foreground: ${onAccent} !important;
  --theia-menu-selectionBackground: ${fill} !important;
  --theia-menu-selectionForeground: ${onAccent} !important;

  /* Progress bar */
  --theia-progressBar-background: ${accent} !important;

  /* Links, and the quick pick's group labels (the registry cannot hold a var()) */
  --theia-textLink-foreground: ${accentText} !important;
  --theia-textLink-activeForeground: ${accentText} !important;
  --theia-editorLink-activeForeground: ${accentText} !important;
  --theia-pickerGroup-foreground: ${accentText} !important;

  /* Activity bar active highlight */
  --theia-activityBar-activeBorder: ${accent} !important;
  --theia-activityBar-activeBackground: ${accentSubtle} !important;
  --theia-activityBar-activeFocusBorder: ${accent} !important;

  /* Input options (e.g. case-sensitive toggle) */
  --theia-inputOption-activeBackground: ${accentSubtle} !important;
  --theia-inputOption-activeBorder: ${accent} !important;
  --theia-inputOption-activeForeground: ${accentText} !important;

  /* Editor cursor */
  --theia-editorCursor-foreground: ${accent} !important;

  /* SCM badges. The other five states read from the shared --sl-status-*
     design tokens (already theme-branched per [data-sl-theme], including
     high contrast) rather than new literals here, so they stay legible
     without duplicating this file's isDark branching. */
  --theia-gitDecoration-addedResourceForeground: ${accentText} !important;
  --theia-gitDecoration-modifiedResourceForeground: var(--sl-status-warning) !important;
  --theia-gitDecoration-deletedResourceForeground: var(--sl-status-danger) !important;
  --theia-gitDecoration-untrackedResourceForeground: var(--sl-status-success) !important;
  --theia-gitDecoration-renamedResourceForeground: var(--sl-status-info) !important;
  --theia-gitDecoration-conflictingResourceForeground: var(--sl-status-danger) !important;
}`;

  const neutralsCss = `
:root {
  /* Base surfaces */
  --theia-editor-background: ${canvas} !important;
  --theia-editorGutter-background: ${canvas} !important;
  --theia-breadcrumb-background: ${canvas} !important;
  --theia-activityBar-background: ${canvas} !important;
  --theia-statusBar-background: ${canvas} !important;
  --theia-statusBar-noFolderBackground: ${canvas} !important;
  --theia-statusBarItem-hoverBackground: ${surface} !important;
  --theia-statusBarItem-activeBackground: ${raised} !important;
  --theia-titleBar-activeBackground: ${canvas} !important;
  --theia-titleBar-inactiveBackground: ${canvas} !important;
  --theia-terminal-background: ${canvas} !important;
  --theia-editorGroupHeader-tabsBackground: ${canvas} !important;

  /* Raised-once surfaces */
  --theia-sideBar-background: ${surface} !important;
  --theia-sideBarSectionHeader-background: ${surface} !important;
  --theia-panel-background: ${surface} !important;
  --theia-panelSectionHeader-background: ${surface} !important;

  /* Floating surfaces (menus, dropdowns, inputs, widgets) */
  --theia-menu-background: ${raised} !important;
  --theia-dropdown-background: ${raised} !important;
  --theia-input-background: ${raised} !important;
  --theia-quickInput-background: ${raised} !important;
  --theia-editorWidget-background: ${raised} !important;
  --theia-notifications-background: ${raised} !important;

  /* Selection is a tile (kit 0.31): the tile rung under the primary ink on
     Theia's lists and trees and the quick pick, focused or not. The tile is
     found by the seam spexr.css draws on it (the accent where the list has
     focus, the muted ink where it has not), with its ring and cast. Monaco's
     own lists (suggest, code actions) read the registry instead and keep
     Theia's colours. Kit roles, not hex, so the tile follows the theme the
     kit resolves. Matched characters are the accent as text (#5b6cff on the
     white tile read 4.17:1). Theia core's CommonFrontendContribution
     re-registers list.* with its blue AFTER our ColorContribution, so only
     !important reliably wins here. */
  --theia-list-activeSelectionBackground: var(--slc-tile) !important;
  --theia-list-activeSelectionForeground: var(--slc-text) !important;
  --theia-list-activeSelectionIconForeground: var(--slc-text) !important;
  --theia-list-inactiveSelectionBackground: var(--slc-tile) !important;
  --theia-list-inactiveSelectionForeground: var(--slc-text) !important;
  --theia-list-focusAndSelectionOutline: transparent !important;
  --theia-list-focusHighlightForeground: var(--slc-accent-text) !important;
  --theia-list-highlightForeground: var(--slc-accent-text) !important;
  --theia-quickInputList-focusBackground: var(--slc-tile) !important;
  --theia-quickInputList-focusForeground: var(--slc-text) !important;

  /* Foreground */
  --theia-foreground: ${fg} !important;
  --theia-editor-foreground: ${fg} !important;
  --theia-tab-activeForeground: ${fg} !important;
  --theia-tab-inactiveForeground: ${fgMuted} !important;
  --theia-descriptionForeground: ${fgMuted} !important;
  --theia-statusBar-foreground: ${fgMuted} !important;
  --theia-titleBar-activeForeground: ${fgMuted} !important;

  /* Borders */
  --theia-sideBar-border: ${line} !important;
  --theia-panel-border: ${line} !important;
  --theia-editorGroup-border: ${line} !important;
  --theia-titleBar-border: ${line} !important;
  --theia-statusBar-border: ${line} !important;
  --theia-menu-border: ${line} !important;
  --theia-input-border: ${line} !important;
  --theia-editorWidget-border: ${line} !important;
  --theia-activityBar-border: ${line} !important;
}`;
  return font + css + neutralsCss;
}
