import { injectable } from "@theia/core/shared/inversify";
import { isOSX } from "@theia/core/lib/common/os";
import type { PreferenceContribution, PreferenceSchemaService } from "@theia/core/lib/common/preferences/preference-schema";
import { PREF_WINDOW_TITLE_BAR_STYLE } from "@theia/core/lib/electron-common/electron-window-preferences";

/**
 * `window.titleBarStyle` defaults to `custom` on Windows and Linux, matching
 * the frame the main process now picks there (SpexrElectronMainApplication).
 * Theia's default is native on Linux, and at startup its menu contribution
 * writes the style the window started in into the user's settings whenever
 * that differs from the default: without this override every Linux user would
 * find `"window.titleBarStyle": "custom"` written into their settings. macOS
 * keeps Theia's default, `native`, where the setting is hidden.
 */
@injectable()
export class SpexrTitleBarPreferenceContribution implements PreferenceContribution {
  async initSchema(service: PreferenceSchemaService): Promise<void> {
    if (!isOSX) service.registerOverride(PREF_WINDOW_TITLE_BAR_STYLE, undefined, "custom");
  }
}
