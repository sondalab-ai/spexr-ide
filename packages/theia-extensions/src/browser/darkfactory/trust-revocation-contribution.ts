import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { MessageService } from "@theia/core/lib/common/message-service";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import { SpexrScheduleServiceProxy } from "./schedule/schedule-client.js";
import type { SpexrScheduleService } from "../../common/schedule/schedule-protocol.js";
import { runningScheduledTasks, trustRevokedMessage } from "./trust-revocation.js";

/**
 * Warns when workspace trust is withdrawn while the agent or a scheduled task
 * runs. It stops nothing (the person decides), and says that new sessions will
 * not start. The gate it explains is the window's workspace trust.
 */
@injectable()
export class SpexrTrustRevocationContribution implements FrontendApplicationContribution {
  @inject(ClaudeTerminalManager) private readonly terminal!: ClaudeTerminalManager;
  @inject(SpexrScheduleServiceProxy) private readonly schedules!: SpexrScheduleService;
  @inject(MessageService) private readonly messages!: MessageService;

  onStart(): void {
    this.terminal.onDidChangeTrust((trusted) => {
      if (!trusted) void this.warn();
    });
  }

  private async warn(): Promise<void> {
    const snapshot = await this.schedules.snapshot().catch(() => undefined);
    const text = trustRevokedMessage({ agent: this.terminal.isRunning(), scheduledTasks: snapshot ? runningScheduledTasks(snapshot) : 0 });
    if (text) this.messages.warn(text);
  }
}
