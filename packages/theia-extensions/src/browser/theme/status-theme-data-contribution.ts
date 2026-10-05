import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { MonacoThemeRegistry } from "@theia/monaco/lib/browser/textmate/monaco-theme-registry";
import { SPEXR_EDITOR_THEMES, withoutStatusGrounds } from "./status-theme-data.js";

/**
 * Takes the status grounds out of the light and dark themes' data, so a
 * plugin's status item resolves spexr's registered kit fills. Runs at
 * initialize: Monaco's contribution registers the default themes while it is
 * constructed, before any contribution initializes, and plugins set their
 * items later. Monaco refreshes a theme it is given again.
 */
@injectable()
export class SpexrStatusThemeDataContribution implements FrontendApplicationContribution {
  @inject(MonacoThemeRegistry) private readonly themes!: MonacoThemeRegistry;

  initialize(): void {
    for (const name of SPEXR_EDITOR_THEMES) {
      const data = this.themes.getThemeData(name);
      if (data) this.themes.setTheme(name, { ...data, colors: withoutStatusGrounds(data.colors) });
    }
  }
}
