import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { StatusBarViewModel } from "@theia/core/lib/browser/status-bar/status-bar-view-model";
import type { StatusBarEntry } from "@theia/core/lib/browser/status-bar/status-bar-types";
import { SPEXR_STATUS_RESOURCES_PREFERENCE } from "../preferences/spexr-preferences.js";
import { shapeStatusEntry, RESOURCES_ID } from "./status-items.js";

/**
 * Theia's status bar model with the bar's entries chosen (S6d, D14): every
 * entry set goes through {@link shapeStatusEntry}, so a hidden entry is never
 * in the DOM and the right side keeps Lumen's order. The model is shared by
 * the bar widget and the `StatusBar` service, so one override covers both.
 * The resource meter entry is dropped and brought back as its preference
 * changes (its contribution keeps the last sample).
 */
@injectable()
export class SpexrStatusBarViewModel extends StatusBarViewModel {
  @inject(PreferenceService) private readonly preferences!: PreferenceService;

  private readonly lastSet = new Map<string, StatusBarEntry>();

  @postConstruct()
  protected initPolicy(): void {
    this.preferences.onPreferenceChanged((e) => {
      if (e.preferenceName !== SPEXR_STATUS_RESOURCES_PREFERENCE) return;
      const kept = this.lastSet.get(RESOURCES_ID);
      if (kept) this.set(RESOURCES_ID, kept);
    });
  }

  override set(id: string, entry: StatusBarEntry): void {
    this.lastSet.set(id, entry);
    const shaped = shapeStatusEntry(id, entry, { resources: this.preferences.get<boolean>(SPEXR_STATUS_RESOURCES_PREFERENCE, false) });
    if (shaped) super.set(id, shaped);
    else super.remove(id);
  }
}
