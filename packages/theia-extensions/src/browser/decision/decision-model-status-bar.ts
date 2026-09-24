import { injectable, inject } from "@theia/core/shared/inversify";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import type { DecisionModelStatus, SpexrDecisionService } from "../../common/decision-protocol.js";
import { SpexrDecisionServiceProxy } from "./decision-service-proxy.js";
import { downloadStatusText } from "./download-status-text.js";

const ENTRY_ID = "spexr-decision-model-download";
const POLL_MS = 3000;

/**
 * Shows the background download of the decision model's weights (spec 0017)
 * in the status bar. watch() is called each time the model is reported to
 * the backend; it polls while a download is waiting or running.
 */
@injectable()
export class SpexrDecisionModelStatusBar {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrDecisionServiceProxy) private readonly service!: SpexrDecisionService;
  private polling = false;

  /**
   * Starts following the backend's download state, unless already following
   * it. Called after every model push, so a model change that starts a new
   * download is picked up.
   */
  watch(): void {
    if (this.polling) return;
    this.polling = true;
    void this.poll();
  }

  /**
   * Renders the current state, and asks again in a few seconds while a
   * download is waiting or running. Stops once it is ready, failed, off or
   * missing; the entry then shows the failure or disappears.
   */
  private async poll(): Promise<void> {
    const status = await this.service.status().catch(() => undefined);
    if (status) this.render(status);
    if (status && (status.state === "waiting" || status.state === "downloading")) {
      setTimeout(() => void this.poll(), POLL_MS);
      return;
    }
    this.polling = false;
  }

  private render(s: DecisionModelStatus): void {
    const text = downloadStatusText(s);
    if (!text) {
      this.statusBar.removeElement(ENTRY_ID);
      return;
    }
    void this.statusBar.setElement(ENTRY_ID, {
      text,
      alignment: StatusBarAlignment.LEFT,
      priority: 90,
      tooltip:
        s.state === "failed"
          ? "The decision model could not be downloaded. SPEXR tries again next time it opens; until then it asks you which expert to use."
          : "Downloading the decision model in the background. Until it is ready, SPEXR asks you which expert to use.",
    });
  }
}
