/**
 * The status item colours spexr registers (spexr-color-contribution.ts). A
 * theme's own data outranks a registry default, and Theia's built-in themes
 * set some of them: light_vs.json the light error ground (#c72e0f), light_vs
 * and dark_vs the remote ground and its label (a green, #16825D). Taken out
 * of the theme data, they resolve to spexr's registration.
 */
export const STATUS_GROUND_COLORS = [
  "statusBarItem.errorBackground",
  "statusBarItem.errorForeground",
  "statusBarItem.warningBackground",
  "statusBarItem.warningForeground",
  "statusBarItem.prominentBackground",
  "statusBarItem.prominentForeground",
  "statusBarItem.remoteBackground",
  "statusBarItem.remoteForeground",
] as const;

/**
 * The Monaco themes behind spexr's light and dark (Theia's built-in ones,
 * core theming.ts `editorTheme`). High contrast (hc-theia) keeps its own.
 */
export const SPEXR_EDITOR_THEMES = ["light-theia", "dark-theia"] as const;

/** A theme's colours without the status grounds spexr registers; a new object, the input untouched. */
export function withoutStatusGrounds(colors: Readonly<Record<string, string>>): Record<string, string> {
  const ids = new Set<string>(STATUS_GROUND_COLORS);
  return Object.fromEntries(Object.entries(colors).filter(([id]) => !ids.has(id)));
}
