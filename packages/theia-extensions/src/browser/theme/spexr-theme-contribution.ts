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

    // Always move our <style> to end of <head> so it wins the source-order cascade
    // regardless of when Theia inserts its own theme <style> elements.
    let el = document.getElementById("spexr-theia-accent-overrides");
    if (el) el.remove();
    el = document.createElement("style");
    el.id = "spexr-theia-accent-overrides";
    el.textContent = css;
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
