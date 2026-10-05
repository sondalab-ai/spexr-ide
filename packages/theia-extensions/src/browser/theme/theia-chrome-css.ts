import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";
import { ACCENT, ACCENT_FILL, fillStep, labelOn } from "./spexr-accent.js";

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
  const theme         = isDark ? "dark" : "light";
  // The accent and its wash, from the kit's accent registry (12% on ink, 10% on paper).
  const accent        = ACCENT[theme];
  const accentSubtle  = `color-mix(in srgb, ${accent} ${isDark ? 12 : 10}%, transparent)`;
  // The accent as text or a thin line: the kit's role, capped on light so it
  // reads at 4.5:1 (#5b6cff itself is 3.37:1 on the light canvas).
  const accentText    = "var(--slc-accent-text)";
  // A hovered link: one kit shade step further from its ground (deeper on
  // paper, lighter on ink), along the line to that pole as the kit steps a
  // fill, so it stays in sRGB, hovering changes lightness and contrast rises.
  // spexr-accent.ts accentTextActive() gives the registry the same colour.
  const step = "var(--slc-shade-step, 0.075)";
  const accentTextActive = isDark
    ? `oklch(from var(--slc-accent-text) calc(l + ${step}) calc(c * pow(max(0, 1 - ${step} / max(1 - l, 0.001)), 1.5)) h)`
    : `oklch(from var(--slc-accent-text) calc(l - ${step}) calc(c * max(0, 1 - ${step} / max(l, 0.001))) h)`;
  // A fill that carries a label: the registered fill and its hover, per
  // theme (the kit's --slc-accent-fill, which its products.css sets from the
  // same registry).
  const fill          = ACCENT_FILL[theme];
  // Hovered by the kit's own step rule, so Theia's buttons and the kit's
  // primaries hover in the same indigo.
  const fillHover     = fillStep(fill, "hover");
  // The kit's label on that fill: white on spexr's fill today, the dark pole
  // on a light one. The step keeps it, hovered and pressed.
  const onAccent      = labelOn(fill);

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

  /* Native buttons. Buttons, badges and the menu's selection carry a label,
     so they take the registered fill with the kit's label on it (white
     5.41:1, hovered 6.67), never the #5b6cff accent (white 4.17). */
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
  --theia-textLink-activeForeground: ${accentTextActive} !important;
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
  /* Base surfaces. The editor's is the canvas here, the frame behind the
     islands (Theia paints the shell and a maximised area with it); each
     island re-binds the editor, tab strip, breadcrumb, panel and side bar
     surfaces to its own fill (spexr.css, THE WORKBENCH). */
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
  --theia-editorGroupHeader-tabsBackground: ${canvas} !important;

  /* Status items that paint a ground of their own, through these variables
     (a plugin's items take literals from the registry instead, which holds
     the same fills: spexr-color-contribution.ts). The fill is the boundary, at least 3:1
     against the canvas; the label is the kit's label rule on it, at least
     4.5:1 (contrast.test.ts). A prominent item (Restricted Mode, Session
     Preferences) is neutral: the muted ink as a fill; Theia's default was a
     50% black under the muted ink. Offline turns the whole bar the kit's
     warning, hovered and pressed by the kit's step; its label was the
     registry's editor background, which spexr does not set. */
  --theia-statusBarItem-prominentBackground: var(--slc-text-muted) !important;
  --theia-statusBarItem-prominentForeground: oklch(from var(--slc-text-muted) var(--_sl-on)) !important;
  --theia-statusBarItem-prominentHoverBackground: var(--slc-text-muted) !important;
  --theia-statusBarItem-prominentHoverForeground: oklch(from var(--slc-text-muted) var(--_sl-on)) !important;
  --theia-statusBar-offlineBackground: var(--slc-warning) !important;
  --theia-statusBar-offlineForeground: var(--slc-on-warning) !important;
  --theia-statusBarItem-offlineHoverBackground: oklch(from var(--slc-warning) var(--_sl-step-hover)) !important;
  --theia-statusBarItem-offlineActiveBackground: oklch(from var(--slc-warning) var(--_sl-step-press)) !important;

  /* Raised-once surfaces: an island at rest. The terminal is one too, as
     spexr-color-contribution.ts registers it for xterm's canvas; it does not
     follow a lit island's raised rung (xterm paints from the registry). */
  --theia-terminal-background: ${surface} !important;
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

  /* A notification's severity glyph (and the language status's) in the kit's
     tones: spexr.css washes the glyph in its own tone and ticks the toast
     with it. Theia's were the editor's error, warning and info blues. */
  --theia-notificationsInfoIcon-foreground: var(--slc-info-text, var(--slc-info)) !important;
  --theia-notificationsWarningIcon-foreground: var(--slc-warning-text, var(--slc-warning)) !important;
  --theia-notificationsErrorIcon-foreground: var(--slc-danger-text, var(--slc-danger)) !important;

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

  /* The activity bars are the kit's (0.33, .sl-activitybar; spexr.css draws
     the tiles): glyphs in the muted ink on the canvas, the hovered and the
     current one in the primary ink (the current glyph is the accent there).
     Theia's menus at the bars' ends and a plugin's mask icons read these. */
  --theia-activityBar-foreground: ${fg} !important;
  --theia-activityBar-inactiveForeground: ${fgMuted} !important;

  /* Trees toward the kit's .sl-tree: hairline indent guides, the selection's
     own path one border step stronger. */
  --theia-tree-inactiveIndentGuidesStroke: var(--slc-border-subtle) !important;
  --theia-tree-indentGuidesStroke: var(--slc-border) !important;

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
