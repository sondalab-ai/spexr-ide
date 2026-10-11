import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import type { SpexrResourceService } from "../../common/resource-protocol.js";
import { formatResourceEntry, formatResourceLabel, renderResourceTooltip } from "./resource-status-format.js";
import { isPowerSaving } from "../power/power-save-dom.js";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { SPEXR_STATUS_RESOURCES_PREFERENCE } from "../preferences/spexr-preferences.js";
import { pollAction } from "./resource-poll-gate.js";

/** Symbol for the backend resource service proxy, bound in the frontend module. */
export const SpexrResourceServiceProxy = Symbol("SpexrResourceServiceProxy");

const ENTRY_ID = "spexr-resources";
const POLL_MS = 4_000;
/** Slower while saving power: each sample is a `ps` run in the backend. */
const POWER_SAVE_POLL_MS = 20_000;

/**
 * SPEXR's memory and CPU in the status bar (when `spexr.statusBar.resources` is on), with a per-group breakdown on
 * hover. Polls the backend while the window is visible, less often while
 * saving power; a hidden window skips its turns. The entry is removed where usage cannot be measured.
 */
@injectable()
export class SpexrResourceStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrResourceServiceProxy) private readonly service!: SpexrResourceService;
  @inject(PreferenceService) private readonly preferences!: PreferenceService;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;

  onStart(): void {
    this.sync();
    this.preferences.onPreferenceChanged((e) => {
      if (e.preferenceName === SPEXR_STATUS_RESOURCES_PREFERENCE) this.sync();
    });
  }

  /** Follow `spexr.statusBar.resources`: no polling and no entry while it is off (the default). */
  private sync(): void {
    const action = pollAction(this.preferences.get<boolean>(SPEXR_STATUS_RESOURCES_PREFERENCE, false), this.running);
    if (action === "start") {
      this.running = true;
      void this.poll();
    } else if (action === "stop") {
      this.running = false;
      if (this.timer !== undefined) clearTimeout(this.timer);
      this.timer = undefined;
      this.statusBar.removeElement(ENTRY_ID);
    }
  }

  onStop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  /** Render the latest sample unless hidden, then ask again after `POLL_MS`. */
  private async poll(): Promise<void> {
    if (!this.running) return;
    if (!document.hidden) {
      const usage = await this.service.usage().catch(() => undefined);
      if (usage) {
        void this.statusBar.setElement(ENTRY_ID, {
          text: formatResourceEntry(usage),
          tooltip: renderResourceTooltip(usage, this.interval()),
          accessibilityInformation: { label: formatResourceLabel(usage) },
          alignment: StatusBarAlignment.RIGHT,
          priority: 10,
        });
      } else {
        this.statusBar.removeElement(ENTRY_ID);
      }
    }
    if (!this.running) return;
    this.timer = setTimeout(() => void this.poll(), this.interval());
  }

  /** How long until the next sample: longer while saving power. */
  private interval(): number {
    return isPowerSaving() ? POWER_SAVE_POLL_MS : POLL_MS;
  }
}
