/**
 * Theme registry. Built-in themes are first-class; custom themes load from JSON
 * via `loadCustomTheme`. The shell applies the active theme by setting
 * `data-sl-theme` on the root element — CSS variable cascades do the rest.
 */

export type ThemeId = "light" | "dark" | "high-contrast" | (string & {});

export interface ThemeManifest {
  readonly id: ThemeId;
  readonly label: string;
  readonly kind: "light" | "dark" | "high-contrast";
  readonly stylesheet: string;
}

export const BUILT_IN_THEMES: readonly ThemeManifest[] = [
  {
    id: "light",
    label: "Spexr Light",
    kind: "light",
    stylesheet: "@spexr/ui-kit/themes/light.css",
  },
  {
    id: "dark",
    label: "Spexr Dark",
    kind: "dark",
    stylesheet: "@spexr/ui-kit/themes/dark.css",
  },
  {
    id: "high-contrast",
    label: "High Contrast",
    kind: "high-contrast",
    stylesheet: "@spexr/ui-kit/themes/high-contrast.css",
  },
];

export interface CustomThemeDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: ThemeManifest["kind"];
  readonly tokens: Readonly<Record<string, string>>;
}

export function applyTheme(themeId: ThemeId, root: HTMLElement = document.documentElement): void {
  root.setAttribute("data-sl-theme", themeId);
}

export function applyCustomThemeTokens(
  theme: CustomThemeDefinition,
  root: HTMLElement = document.documentElement,
): void {
  for (const [name, value] of Object.entries(theme.tokens)) {
    if (!name.startsWith("--sl-")) {
      throw new Error(`Custom theme token "${name}" must use --sl- prefix`);
    }
    root.style.setProperty(name, value);
  }
  root.setAttribute("data-sl-theme", theme.id);
}

export function detectSystemPreferredKind(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
