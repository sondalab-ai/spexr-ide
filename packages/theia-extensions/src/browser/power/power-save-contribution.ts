import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { MessageService } from "@theia/core/lib/common/message-service";
import type { PowerState, SpexrPowerService } from "../../common/power-protocol.js";
import { applyPowerSave, powerSaveMessage } from "./power-save-dom.js";

/** Symbol for the backend power service proxy, bound in the frontend module. */
export const SpexrPowerServiceProxy = Symbol("SpexrPowerServiceProxy");

const ENTRY_ID = "spexr-power-save";
const POLL_MS = 15_000;

/**
 * Follows the backend's power-saving decision in this window: flags the page
 * (see `applyPowerSave`), shows a status bar marker while saving, and tells
 * the user once when saving starts and once when it ends. A window that
 * opens on mains power says nothing.
 */
@injectable()
export class SpexrPowerSaveContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(MessageService) private readonly messages!: MessageService;
  @inject(SpexrPowerServiceProxy) private readonly service!: SpexrPowerService;
  private saving = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  onStart(): void {
    void this.poll();
  }

  onStop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
  }

  private async poll(): Promise<void> {
    const state = await this.service.state().catch(() => undefined);
    if (state) this.follow(state);
    this.timer = setTimeout(() => void this.poll(), POLL_MS);
  }

  private follow(state: PowerState): void {
    if (state.saving === this.saving) return;
    this.saving = state.saving;
    applyPowerSave(state.saving);
    const text = powerSaveMessage(state.saving, state.level);
    if (state.saving) {
      void this.messages.warn(text);
      void this.statusBar.setElement(ENTRY_ID, {
        text: "$(zap) Power saver",
        tooltip: text,
        alignment: StatusBarAlignment.RIGHT,
        priority: 11,
      });
    } else {
      void this.messages.info(text);
      this.statusBar.removeElement(ENTRY_ID);
    }
  }
}
