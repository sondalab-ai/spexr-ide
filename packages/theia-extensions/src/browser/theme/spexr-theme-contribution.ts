import { injectable, inject } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ThemeService } from "@theia/core/lib/browser/theming";

/** Maps a SPEXR theme id to the matching built-in Theia color theme. */
const THEIA_THEME_BY_SPEXR: Record<string, string> = {
  light: "light",
  dark: "dark",
  "high-contrast": "hc-theia",
};

/**
 * Sets the `data-sl-theme` attribute on the document so the design tokens
 * resolve to a concrete theme, and syncs Theia's own color theme so native
 * chrome (tab bars, editor, terminal) matches the SPEXR tokens. Reads the saved
 * preference (or system) and subscribes to changes via prefers-color-scheme.
 */
@injectable()
export class SpexrThemeContribution implements FrontendApplicationContribution {
  @inject(ThemeService)
  private readonly themeService!: ThemeService;

  onStart(): void {
    const stored = this.readStoredTheme();
    const resolved = stored ?? this.systemPreference();

    // Register BEFORE applyTheme so we catch the initial onDidColorThemeChange too.
    // setTimeout(0): Theia may apply CSS vars asynchronously after firing this event;
    // delaying ensures we always run after Theia's <style> is written.
    this.themeService.onDidColorThemeChange(() => {
      const current = document.documentElement.getAttribute("data-sl-theme") ?? resolved;
      setTimeout(() => this.applyAccentOverrides(current), 0);
    });

    this.applyTheme(resolved);

    if (!stored && typeof window !== "undefined" && window.matchMedia) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", (event) => {
        this.applyTheme(event.matches ? "dark" : "light");
      });
    }
  }

  /** Apply a SPEXR theme to both the design tokens and Theia's native chrome. */
  private applyTheme(spexrTheme: string): void {
    document.documentElement.setAttribute("data-sl-theme", spexrTheme);
    const theiaId = THEIA_THEME_BY_SPEXR[spexrTheme];
    if (theiaId && this.themeService.getCurrentTheme().id !== theiaId) {
      if (this.themeService.getThemes().some((t) => t.id === theiaId)) {
        this.themeService.setCurrentTheme(theiaId, true);
      }
    }
    this.applyAccentOverrides(spexrTheme);
  }

  /**
   * Inject CSS variable overrides so Theia's native chrome (buttons, focus
   * rings, badges, tabs, activity bar) uses the SPEXR violet accent instead
   * of the default Theia blue. Theia computes `--theia-*` variables from its
   * color registry; overriding them here takes precedence via document order.
   */
  private applyAccentOverrides(spexrTheme: string): void {
    const isDark = spexrTheme === "dark";
    const accent        = isDark ? "#8b96ff" : "#5b6cff";
    const accentHover   = isDark ? "#a3acff" : "#4858ee";
    const accentActive  = isDark ? "#6b78f0" : "#3645d4";
    const accentSubtle  = isDark ? "rgba(139,150,255,0.12)" : "rgba(91,108,255,0.1)";
    const onAccent      = "#ffffff";

    // Sondalab surface neutrals — pushed into Theia's native chrome so the
    // editor/sidebar/tabs/terminal share the same (slightly teal) grays as the
    // SPEXR-styled panels, instead of Theia's default neutral gray. High
    // contrast is left to Theia's own HC theme (see the guard below).
    const canvas  = isDark ? "#070A0D" : "#ECE4D4";  // deepest — activity bar, status bar, editor
    const surface = isDark ? "#0F151A" : "#F6F1E6";  // sidebar, panels, active tab
    const raised  = isDark ? "#131C23" : "#FFFFFF";  // menus, dropdowns, widgets, inputs
    const fg      = isDark ? "#DAE3E4" : "#15211F";
    const fgMuted = isDark ? "#6E8088" : "#6E7B78";
    const line    = isDark ? "#1C2830" : "#D8CEBC";  // solid border matching the surfaces

    const css = `
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

  /* SCM badges */
  --theia-gitDecoration-addedResourceForeground: ${accent} !important;
}`;

    // Neutral surfaces: only for light/dark. In high contrast, leave Theia's own
    // HC theme untouched (its grays are WCAG-tuned; a teal cast would break it).
    const neutralsCss = spexrTheme === "high-contrast" ? "" : `
:root {
  /* Base surfaces */
  --theia-editor-background: ${canvas} !important;
  --theia-editorGutter-background: ${canvas} !important;
  --theia-breadcrumb-background: ${canvas} !important;
  --theia-activityBar-background: ${canvas} !important;
  --theia-statusBar-background: ${canvas} !important;
  --theia-statusBar-noFolderBackground: ${canvas} !important;
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

    // Always move our <style> to end of <head> so it wins the source-order cascade
    // regardless of when Theia inserts its own theme <style> elements.
    let el = document.getElementById("spexr-theia-accent-overrides");
    if (el) el.remove();
    el = document.createElement("style");
    el.id = "spexr-theia-accent-overrides";
    el.textContent = css + neutralsCss;
    document.head.appendChild(el);
  }

  private readStoredTheme(): string | undefined {
    try {
      return globalThis.localStorage?.getItem("spexr.theme") ?? undefined;
    } catch {
      return undefined;
    }
  }

  private systemPreference(): string {
    if (typeof window === "undefined") return "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
}
