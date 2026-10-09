/** The two themes spexr draws, as the kit names them. High contrast is a third, kept as Theia's own. */
export type SpexrThemeKind = "light" | "dark";

/**
 * The Theia colour themes spexr registers, and the Monaco themes behind them
 * (the same names). A colour theme names its Monaco theme in `editorTheme`.
 */
export const SPEXR_COLOR_THEMES: Readonly<Record<SpexrThemeKind, string>> = {
  light: "spexr-light",
  dark: "spexr-dark",
};

export const SPEXR_COLOR_THEME_LABELS: Readonly<Record<SpexrThemeKind, string>> = {
  light: "SPEXR Light",
  dark: "SPEXR Dark",
};

/**
 * The ids a profile holds from before the spexr themes existed: Theia's
 * built-in light and dark. A stored `workbench.colorTheme` or localStorage
 * `theme` of one of these still resolves, and is moved to the spexr theme of
 * the same kind the first time the theme is applied.
 */
export const LEGACY_THEME_ALIASES: Readonly<Record<string, SpexrThemeKind>> = {
  light: "light",
  dark: "dark",
};

/** Maps a SPEXR theme id (the `data-sl-theme` value) to the Theia colour theme that carries it. */
export const THEIA_THEME_BY_SPEXR: Readonly<Record<string, string>> = {
  light: SPEXR_COLOR_THEMES.light,
  dark: SPEXR_COLOR_THEMES.dark,
  "high-contrast": "hc-theia",
};

/**
 * The same pairing read the other way, for changes that start on Theia's side:
 * the spexr themes, the legacy ids that alias them, and high contrast.
 */
export const SPEXR_THEME_BY_THEIA: Readonly<Record<string, string>> = {
  ...Object.fromEntries(Object.entries(THEIA_THEME_BY_SPEXR).map(([spexr, theia]) => [theia, spexr])),
  ...LEGACY_THEME_ALIASES,
};
