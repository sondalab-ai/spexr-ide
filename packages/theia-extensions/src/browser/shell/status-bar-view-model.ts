import { inject, injectable } from "@theia/core/shared/inversify";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { StatusBarViewModel } from "@theia/core/lib/browser/status-bar/status-bar-view-model";
import type { StatusBarEntry } from "@theia/core/lib/browser/status-bar/status-bar-types";
import { SPEXR_STATUS_RESOURCES_PREFERENCE } from "../preferences/spexr-preferences.js";
import { shapeStatusEntry } from "./status-items.js";

/**
 * Theia's status bar model with the bar's entries chosen (S6d, D14): every
 * entry set goes through {@link shapeStatusEntry}, so a hidden entry is never
 * in the DOM and the right side keeps Lumen's order. The model is shared by
 * the bar widget and the `StatusBar` service, so one override covers both.
 * It keeps no sample of its own: the resource meter's entry comes and goes
 * with its contribution's poller, which follows the same preference.
 */
@injectable()
export class SpexrStatusBarViewModel extends StatusBarViewModel {
  @inject(PreferenceService) private readonly preferences!: PreferenceService;

  override set(id: string, entry: StatusBarEntry): void {
    const shaped = shapeStatusEntry(id, entry, { resources: this.preferences.get<boolean>(SPEXR_STATUS_RESOURCES_PREFERENCE, false) });
    if (shaped) super.set(id, shaped);
    else super.remove(id);
  }
}
