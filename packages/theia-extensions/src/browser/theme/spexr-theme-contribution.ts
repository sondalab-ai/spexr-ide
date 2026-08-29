import { injectable, inject } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";

/** Maps a SPEXR theme id to the matching built-in Theia color theme. */
const THEIA_THEME_BY_SPEXR: Record<string, string> = {
  light: "light",
  dark: "dark",
  "high-contrast": "hc-theia",
};

/** The same pairing read the other way, for changes that start on Theia's side. */
const SPEXR_THEME_BY_THEIA: Record<string, string> = Object.fromEntries(
  Object.entries(THEIA_THEME_BY_SPEXR).map(([spexr, theia]) => [theia, spexr]),
);

/**
 * Keeps the design tokens and Theia's native chrome on the same theme.
 *
 * Sets `data-sl-theme` on the document so the tokens resolve, and syncs Theia's
 * own color theme so tab bars, editor and terminal match. The two follow each
 * other in both directions: picking a theme in Theia's own picker moves the
 * tokens, and this contribution's resolution moves Theia's theme.
 *
 * Theia's restored theme is the source of truth when the user has expressed no
 * SPEXR-specific choice — it is the one thing that actually persists a decision.
 * The OS preference is the last resort, and is read from the value the startup
 * guard captured, not live: see {@link systemPreference}.
 */
@injectable()
export class SpexrThemeContribution implements FrontendApplicationContribution {
  @inject(ThemeService)
  private readonly themeService!: ThemeService;

  onStart(): void {
    const stored = this.readStoredTheme();
    const resolved = stored ?? this.theiaTheme() ?? this.systemPreference();

    // Register BEFORE applyTheme so we catch the initial onDidColorThemeChange too.
    // setTimeout(0): Theia may apply CSS vars asynchronously after firing this event;
    // delaying ensures we always run after Theia's <style> is written.
    this.themeService.onDidColorThemeChange((event) => {
      // Derive the theme from the event rather than re-reading `data-sl-theme`:
      // that attribute only ever changes here, so a theme picked in Theia's own
      // picker used to leave the SPEXR tokens on the previous theme.
      const next = SPEXR_THEME_BY_THEIA[event.newTheme.id];
      // A theme SPEXR has no tokens for (a third-party one): leave the tokens
      // where they are rather than guessing a mapping.
      if (!next) return;
      setTimeout(() => this.applyTheme(next), 0);
    });

    this.applyTheme(resolved);

    if (!stored && typeof window !== "undefined" && window.matchMedia) {
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      media.addEventListener("change", (event) => {
        this.applyTheme(event.matches ? "dark" : "light");
      });
    }
  }

  /** The SPEXR theme matching Theia's restored color theme, when it maps to one. */
  private theiaTheme(): string | undefined {
    return SPEXR_THEME_BY_THEIA[this.themeService.getCurrentTheme().id];
  }

  /** Apply a SPEXR theme to both the design tokens and Theia's native chrome. */
  private applyTheme(spexrTheme: string): void {
    document.documentElement.setAttribute("data-sl-theme", spexrTheme);
    // The anti-flash guard in index.html (apps/desktop/preload.html) paints the
    // canvas with an inline style, which would outrank the stylesheet for every
    // later theme change. Hand the element back now that the tokens are loaded.
    document.documentElement.style.removeProperty("background");
    const theiaId = THEIA_THEME_BY_SPEXR[spexrTheme];
    if (theiaId && this.themeService.getCurrentTheme().id !== theiaId) {
      if (this.themeService.getThemes().some((t) => t.id === theiaId)) {
        this.themeService.setCurrentTheme(theiaId, true);
      }
    }
    this.applyAccentOverrides(spexrTheme);
    this.rememberPreloadBackground(spexrTheme);
    this.rememberRenderedTheme(spexrTheme);
  }

  /**
   * Record the theme actually rendered, for the anti-flash guard in index.html.
   *
   * Deliberately a different key from `spexr.theme`: that one means "the user
   * chose this", and its absence is what keeps the app following the OS. This
   * one means "this is what the last run painted", which is all the guard needs
   * — and without it the guard has nothing to go on, because in Electron
   * `prefers-color-scheme` follows `nativeTheme.themeSource`, which still
   * reports the OS until Theia loads its own theme from the bundle.
   */
  private rememberRenderedTheme(spexrTheme: string): void {
    try {
      globalThis.localStorage?.setItem("spexr.theme.last", spexrTheme);
    } catch {
      // Storage unavailable; the guard falls back to the OS preference.
    }
  }

  /**
   * Keep Theia's `theme.background` in sync with the SPEXR canvas.
   *
   * `ThemePreloadContribution` reads that localStorage key during preload and
   * writes it into `--theia-editor-background`, which is what every shell
   * surface paints with before any stylesheet has an opinion. Theia fills the
   * key from `colors.getCurrentColor('editor.background')` — the built-in
   * theme's white or #1E1E1E, since SPEXR overrides that color only in the CSS
   * `!important` layer and never in the registry. Left alone, the next launch
   * therefore paints the whole shell in the built-in theme until this
   * contribution runs. Written last, so it wins over Theia's own update.
   */
  private rememberPreloadBackground(spexrTheme: string): void {
    if (spexrTheme === "high-contrast") return;
    try {
      const { canvas } = SPEXR_NEUTRALS[spexrTheme === "light" ? "light" : "dark"];
      globalThis.localStorage?.setItem("theme.background", canvas);
    } catch {
      // Storage unavailable; the next launch just falls back to Theia's value.
    }
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
    const { canvas, surface, raised, fg, fgMuted, line } =
      SPEXR_NEUTRALS[isDark ? "dark" : "light"];

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

  /**
   * The OS color preference.
   *
   * Prefers the value the startup guard in index.html recorded, because a live
   * `prefers-color-scheme` read is not the OS setting here: in Electron the
   * renderer's media query follows `nativeTheme.themeSource`, which Theia pins
   * to the application's own theme as soon as the bundle loads. The guard runs
   * before that, while the query still answers honestly.
   */
  private systemPreference(): string {
    try {
      const osDark = globalThis.localStorage?.getItem("spexr.os.dark");
      if (osDark === "1") return "dark";
      if (osDark === "0") return "light";
    } catch {
      // Storage unavailable; fall through to the live query.
    }
    if (typeof window === "undefined") return "dark";
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
}
