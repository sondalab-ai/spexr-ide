import { injectable, inject } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { mount as mountEffects } from "@spexr/ui-kit/effects";
import { SPEXR_NEUTRALS } from "./spexr-neutrals.js";
import { theiaChromeCss } from "./theia-chrome-css.js";

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
    // Selects SPEXR's indigo-tinted neutrals in the kit's products.css, which
    // only match on the element that carries data-sl-theme (or an ancestor).
    document.documentElement.setAttribute("data-sl-product", "spexr");
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
    this.reportWindowBackground(spexrTheme);
    this.armEffects();
  }

  /**
   * Arm the kit's effects runtime: the live light on working agents, the press
   * light on controls, the specular edge on glass. Tried on every theme change
   * because the kit refuses to arm under high contrast, and arms once for good
   * after that; later calls return at once. Reduced motion is the kit's call.
   */
  private armEffects(): void {
    mountEffects(document);
  }

  /**
   * Tell the Electron main process what this window's background is.
   *
   * `saveWindowState` persists `customBackgroundColor ?? window.getBackgroundColor()`,
   * and `getLastWindowOptions` applies that saved state *after* the configured
   * `windowOptions`, so it decides the color the window is painted with before
   * the document's first paint — around half a second, and the whole of the
   * startup flash. Theia only sets `customBackgroundColor` from a theme
   * *change* (`ElectronMenuContribution.handleThemeChange`), so an application
   * that starts on the right theme and never switches never reports one: a
   * stale value survives, is re-saved on every exit, and never heals.
   */
  private reportWindowBackground(spexrTheme: string): void {
    if (spexrTheme === "high-contrast") return;
    const api = (globalThis as { electronTheiaCore?: { setBackgroundColor?: (c: string) => void } })
      .electronTheiaCore;
    const { canvas } = SPEXR_NEUTRALS[spexrTheme === "light" ? "light" : "dark"];
    api?.setBackgroundColor?.(canvas);
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
   * Inject {@link theiaChromeCss} for the theme. Theia computes `--theia-*`
   * variables from its color registry and writes them inline on the root;
   * the overrides are `!important`, so they win over those.
   */
  private applyAccentOverrides(spexrTheme: string): void {
    // Always move our <style> to end of <head> so it wins the source-order cascade
    // regardless of when Theia inserts its own theme <style> elements.
    let el = document.getElementById("spexr-theia-accent-overrides");
    if (el) el.remove();
    el = document.createElement("style");
    el.id = "spexr-theia-accent-overrides";
    el.textContent = theiaChromeCss(spexrTheme);
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
