import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { SpexrSearchClientDispatcher } from "./smart-search-client.js";
import { SmartSearchCommands } from "./smart-search-contribution.js";
import type { DescriptionJobStatus } from "../../common/search-protocol.js";
import { descriptionJobStatusText } from "./description-job-status-text.js";
import { statusClass } from "../shell/status-dock.js";

const ENTRY_ID = "spexr-description-job";

/** Mirrors the codebase-understanding job in the status bar; click toggles pause/resume. */
@injectable()
export class DescriptionJobStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrSearchClientDispatcher) private readonly client!: SpexrSearchClientDispatcher;

  onStart(): void {
    this.client.onDescriptionJobProgress$((s) => this.render(s));
  }

  private render(s: DescriptionJobStatus): void {
    const entry = descriptionJobStatusText(s);
    if (!entry) {
      this.statusBar.removeElement(ENTRY_ID);
      return;
    }
    void this.statusBar.setElement(ENTRY_ID, {
      text: entry.text,
      className: statusClass({ live: entry.live }),
      alignment: StatusBarAlignment.LEFT,
      priority: 100,
      tooltip:
        s.state === "running" ? "Click to pause understanding"
        : s.state === "paused" ? "Click to resume understanding"
        : "Understanding failed",
      ...(s.state === "running"
        ? { command: SmartSearchCommands.MAP_PAUSE.id }
        : s.state === "paused"
          ? { command: SmartSearchCommands.MAP_RESUME.id }
          : {}),
    });
  }
}
