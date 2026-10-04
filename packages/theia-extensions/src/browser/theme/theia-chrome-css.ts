import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";

/**
 * The CSS SpexrThemeContribution injects for a SPEXR theme: `--theia-*`
 * variable overrides that put Theia's native chrome (buttons, focus rings,
 * badges, tabs, lists, activity bar, status bar) on the SPEXR accent, its
 * registered fill, the SPEXR neutrals and the kit's selection tile, and the
 * kit's UI face (Geist) instead of the platform font. Pure, so it can be
 * rendered outside Theia.
 */
export function theiaChromeCss(spexrTheme: string): string {
  const isDark = spexrTheme === "dark";
  const accent        = isDark ? "#8b96ff" : "#5b6cff";
  const accentHover   = isDark ? "#a3acff" : "#4858ee";
  const accentActive  = isDark ? "#6b78f0" : "#3645d4";
  const accentSubtle  = isDark ? "rgba(139,150,255,0.12)" : "rgba(91,108,255,0.1)";
  const onAccent      = "#ffffff";

  // Sondalab surface neutrals — pushed into Theia's native chrome so the
  // editor/sidebar/tabs/terminal share the same indigo-tinted greys as the
  // SPEXR-styled panels (the kit's generated spexr ladder), instead of
  // Theia's default neutral grey. High contrast is left to Theia's own HC
  // theme (see the guard below).
  const { canvas, surface, raised, fg, fgMuted, line } =
    SPEXR_NEUTRALS[isDark ? "dark" : "light"];

  const css = `
/* Theia's chrome in the kit's UI face (Geist). On body too: Theia's os.css sets
   this variable on body.mac / .windows / .linux, which would shadow :root. The
   editor and terminal keep their own coding mono (editor.fontFamily). */
:root,
body {
  --theia-ui-font-family: var(--sl-font-sans) !important;
}
:root {
  /* Focus ring */
  --theia-focusBorder: ${accent} !important;

  /* Native buttons */
  --theia-button-background: ${accent} !important;
  --theia-button-hoverBackground: ${accentHover} !important;
  --theia-button-foreground: ${onAccent} !important;
  --theia-button-secondaryForeground: ${accent} !important;
  --theia-button-secondaryBackground: ${accentSubtle} !important;
  --theia-button-secondaryHoverBackground: ${accentSubtle} !important;

  /* Badges */
  --theia-badge-background: ${accent} !important;
  --theia-badge-foreground: ${onAccent} !important;

  /* Activity-bar badge + menu selection: baked into the theme JSON as #007ACC,
     so they beat ColorRegistry overrides — only !important reaches them. */
  --theia-activityBarBadge-background: ${accent} !important;
  --theia-activityBarBadge-foreground: ${onAccent} !important;
  --theia-menu-selectionBackground: ${accent} !important;
  --theia-menu-selectionForeground: ${onAccent} !important;

  /* Progress bar */
  --theia-progressBar-background: ${accent} !important;

  /* Links */
  --theia-textLink-foreground: ${accent} !important;
  --theia-textLink-activeForeground: ${accentHover} !important;
  --theia-editorLink-activeForeground: ${accent} !important;

  /* Active tab indicator */
  --theia-tab-activeBorderTop: ${accent} !important;
  --theia-tab-unfocusedActiveBorderTop: ${accentActive} !important;

  /* Activity bar active highlight */
  --theia-activityBar-activeBorder: ${accent} !important;
  --theia-activityBar-activeBackground: ${accentSubtle} !important;
  --theia-activityBar-activeFocusBorder: ${accent} !important;

  /* Input options (e.g. case-sensitive toggle) */
  --theia-inputOption-activeBackground: ${accentSubtle} !important;
  --theia-inputOption-activeBorder: ${accent} !important;
  --theia-inputOption-activeForeground: ${accent} !important;

  /* List / tree selection (file explorer, SCM/git panel, quick-pick).
     Theia core's CommonFrontendContribution re-registers these with its blue
     AFTER our ColorContribution, so only !important reliably wins here. */
  --theia-list-activeSelectionBackground: ${accent} !important;
  --theia-list-activeSelectionForeground: ${onAccent} !important;
  --theia-list-activeSelectionIconForeground: ${onAccent} !important;
  --theia-list-inactiveSelectionBackground: ${accentSubtle} !important;
  --theia-list-focusAndSelectionOutline: ${accent} !important;
  --theia-list-focusHighlightForeground: ${accent} !important;
  --theia-list-highlightForeground: ${accent} !important;
  --theia-quickInputList-focusBackground: ${accent} !important;
  --theia-quickInputList-focusForeground: ${onAccent} !important;

  /* Editor cursor */
  --theia-editorCursor-foreground: ${accent} !important;

  /* SCM badges. The other five states read from the shared --sl-status-*
     design tokens (already theme-branched per [data-sl-theme], including
     high contrast) rather than new literals here, so they stay legible
     without duplicating this file's isDark branching. */
  --theia-gitDecoration-addedResourceForeground: ${accent} !important;
  --theia-gitDecoration-modifiedResourceForeground: var(--sl-status-warning) !important;
  --theia-gitDecoration-deletedResourceForeground: var(--sl-status-danger) !important;
  --theia-gitDecoration-untrackedResourceForeground: var(--sl-status-success) !important;
  --theia-gitDecoration-renamedResourceForeground: var(--sl-status-info) !important;
  --theia-gitDecoration-conflictingResourceForeground: var(--sl-status-danger) !important;
}`;

  // Neutral surfaces: only for light/dark. In high contrast, leave Theia's own
  // HC theme untouched (its grays are WCAG-tuned; an indigo cast would break it).
  const neutralsCss = spexrTheme === "high-contrast" ? "" : `
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
  --theia-tab-inactiveBackground: ${canvas} !important;

  /* Raised-once surfaces */
  --theia-sideBar-background: ${surface} !important;
  --theia-sideBarSectionHeader-background: ${surface} !important;
  --theia-panel-background: ${surface} !important;
  --theia-panelSectionHeader-background: ${surface} !important;
  --theia-tab-activeBackground: ${surface} !important;
  --theia-tab-hoverBackground: ${surface} !important;

  /* Floating surfaces (menus, dropdowns, inputs, widgets) */
  --theia-menu-background: ${raised} !important;
  --theia-dropdown-background: ${raised} !important;
  --theia-input-background: ${raised} !important;
  --theia-quickInput-background: ${raised} !important;
  --theia-editorWidget-background: ${raised} !important;
  --theia-notifications-background: ${raised} !important;

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
  --theia-tab-border: ${line} !important;
  --theia-titleBar-border: ${line} !important;
  --theia-statusBar-border: ${line} !important;
  --theia-menu-border: ${line} !important;
  --theia-input-border: ${line} !important;
  --theia-editorWidget-border: ${line} !important;
  --theia-activityBar-border: ${line} !important;
}`;
  return css + neutralsCss;
}
