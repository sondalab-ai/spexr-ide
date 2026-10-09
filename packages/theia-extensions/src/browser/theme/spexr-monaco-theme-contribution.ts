import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { ThemeService } from "@theia/core/lib/browser/theming";
import { MonacoThemeRegistry } from "@theia/monaco/lib/browser/textmate/monaco-theme-registry";
import type { SpexrThemeKind } from "./spexr-theme-ids.js";
import { SPEXR_COLOR_THEMES, SPEXR_COLOR_THEME_LABELS } from "./spexr-theme-ids.js";
import { monacoThemeJson } from "./spexr-monaco-theme.js";

/** Theia's own editor theme each spexr kind is built on: its workbench colours, and the Monaco base it extends. */
const BUILT_ON: Readonly<Record<SpexrThemeKind, { editorTheme: string; base: "vs" | "vs-dark" }>> = {
  light: { editorTheme: MonacoThemeRegistry.LIGHT_DEFAULT_THEME, base: "vs" },
  dark: { editorTheme: MonacoThemeRegistry.DARK_DEFAULT_THEME, base: "vs-dark" },
};

/**
 * Registers `spexr-dark` and `spexr-light`: Monaco themes with the kit's
 * syntax and editor colours, and the Theia colour themes that carry them.
 *
 * Runs at initialize, like the status theme data: Monaco's contribution has
 * registered Theia's default themes by then (they are the base of these), and
 * the colour themes must exist before the theme contribution switches to
 * them. The themes are registered with the Monaco registry directly, not
 * through `MonacoThemingService.registerParsedTheme`, which would also write
 * their data to IndexedDB and restore it on the next start, with whatever
 * kit colours it held then. High contrast is left as Theia's own.
 */
@injectable()
export class SpexrMonacoThemeContribution implements FrontendApplicationContribution {
  @inject(MonacoThemeRegistry) private readonly monacoThemes!: MonacoThemeRegistry;
  @inject(ThemeService) private readonly themeService!: ThemeService;

  initialize(): void {
    for (const kind of ["dark", "light"] as const) {
      const name = SPEXR_COLOR_THEMES[kind];
      const { editorTheme, base } = BUILT_ON[kind];
      const baseColors = this.monacoThemes.getThemeData(editorTheme)?.colors ?? {};
      this.monacoThemes.register(monacoThemeJson(kind, name, baseColors), undefined, name, base);
      this.themeService.register({ id: name, label: SPEXR_COLOR_THEME_LABELS[kind], type: kind, editorTheme: name });
    }
  }
}
