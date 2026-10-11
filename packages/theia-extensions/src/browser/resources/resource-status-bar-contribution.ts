import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import type { ResourceUsage, SpexrResourceService } from "../../common/resource-protocol.js";
import { formatResourceEntry, formatResourceLabel, renderResourceTooltip } from "./resource-status-format.js";
import { isPowerSaving } from "../power/power-save-dom.js";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { SPEXR_STATUS_RESOURCES_PREFERENCE } from "../preferences/spexr-preferences.js";
import { ResourcePoller } from "./resource-poller.js";

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

  private readonly poller = new ResourcePoller<ResourceUsage>({
    sample: () => this.service.usage().catch(() => undefined),
    show: (usage) =>
      void this.statusBar.setElement(ENTRY_ID, {
        text: formatResourceEntry(usage),
        tooltip: renderResourceTooltip(usage, this.interval()),
        accessibilityInformation: { label: formatResourceLabel(usage) },
        alignment: StatusBarAlignment.RIGHT,
        priority: 10,
      }),
    clear: () => void this.statusBar.removeElement(ENTRY_ID),
    interval: () => this.interval(),
    hidden: () => document.hidden,
    schedule: (run, ms) => setTimeout(run, ms),
    cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  });

  onStart(): void {
    // The preference is read once it has loaded: before that `get` answers with the default (off).
    void this.preferences.ready.then(() => {
      this.sync();
      this.preferences.onPreferenceChanged((e) => {
        if (e.preferenceName === SPEXR_STATUS_RESOURCES_PREFERENCE) this.sync();
      });
    });
  }

  /** Follow `spexr.statusBar.resources`: no polling and no entry while it is off (the default). */
  private sync(): void {
    this.poller.setEnabled(this.preferences.get<boolean>(SPEXR_STATUS_RESOURCES_PREFERENCE, false));
  }

  onStop(): void {
    this.poller.stop();
  }

  /** How long until the next sample: longer while saving power. */
  private interval(): number {
    return isPowerSaving() ? POWER_SAVE_POLL_MS : POLL_MS;
  }
}
