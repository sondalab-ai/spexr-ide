import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import type { SpexrResourceService } from "../../common/resource-protocol.js";
import { formatResourceEntry, formatResourceLabel, renderResourceTooltip } from "./resource-status-format.js";
import { isPowerSaving } from "../power/power-save-dom.js";

/** Symbol for the backend resource service proxy, bound in the frontend module. */
export const SpexrResourceServiceProxy = Symbol("SpexrResourceServiceProxy");

const ENTRY_ID = "spexr-resources";
const POLL_MS = 4_000;
/** Slower while saving power: each sample is a `ps` run in the backend. */
const POWER_SAVE_POLL_MS = 20_000;

/**
 * SPEXR's memory and CPU in the status bar, with a per-group breakdown on
 * hover. Polls the backend while the window is visible, less often while
 * saving power; a hidden window skips its turns. The entry is removed where usage cannot be measured.
 */
@injectable()
export class SpexrResourceStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrResourceServiceProxy) private readonly service!: SpexrResourceService;
  private timer: ReturnType<typeof setTimeout> | undefined;

  onStart(): void {
    void this.poll();
  }

  onStop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  /** Render the latest sample unless hidden, then ask again after `POLL_MS`. */
  private async poll(): Promise<void> {
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
    this.timer = setTimeout(() => void this.poll(), this.interval());
  }

  /** How long until the next sample: longer while saving power. */
  private interval(): number {
    return isPowerSaving() ? POWER_SAVE_POLL_MS : POLL_MS;
  }
}
