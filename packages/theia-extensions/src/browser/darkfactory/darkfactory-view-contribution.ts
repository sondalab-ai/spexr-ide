import { inject, injectable } from "@theia/core/shared/inversify";
import { MessageService } from "@theia/core/lib/common/message-service";
import { WorkspaceTrustService } from "@theia/workspace/lib/browser/workspace-trust-service";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import type { Command, CommandRegistry } from "@theia/core/lib/common/command";
import type { SpexrDarkfactoryWidget } from "./darkfactory-wall-widget.js";
import { DARKFACTORY_VIEW_ID } from "./darkfactory-view-id.js";
import { DARKFACTORY_OPEN_COMMAND, DARKFACTORY_OPEN_SESSION_COMMAND } from "./darkfactory-open-session.js";

export { DARKFACTORY_VIEW_ID };

/**
 * Rescan on demand. The backend both watches the config dirs and polls them, but
 * a session started outside SPEXR can still be a watcher event away from being
 * seen, so the wall keeps an explicit "look again now".
 */
export const DARKFACTORY_REFRESH_COMMAND: Command = {
  id: "spexr.darkfactory.refresh",
  category: "Darkfactory",
  label: "Refresh Sessions",
};

@injectable()
export class SpexrDarkfactoryViewContribution extends AbstractViewContribution<SpexrDarkfactoryWidget> {
  @inject(WorkspaceTrustService) private readonly trust!: WorkspaceTrustService;
  @inject(MessageService) private readonly messages!: MessageService;

  constructor() {
    super({
      widgetId: DARKFACTORY_VIEW_ID,
      widgetName: "Darkfactory",
      defaultWidgetOptions: { area: "main", rank: 3 },
      toggleCommandId: "spexr.view.darkfactory.toggle",
      toggleKeybinding: "ctrlcmd+shift+d",
    });
  }

  /** Attached behind the editors at a restore, not raised (reveal-on-restore.ts, S6c, D8); the toggle or an explicit open still raises it. */
  readonly attachBehind = true;

  override registerCommands(commands: CommandRegistry): void {
    super.registerCommands(commands);
    commands.registerCommand(DARKFACTORY_REFRESH_COMMAND, {
      // Only meaningful with the wall open: `tryGetWidget` avoids creating one
      // just to scan into a widget the user cannot see.
      isEnabled: () => !!this.tryGetWidget(),
      execute: () => this.tryGetWidget()?.refreshNow(),
    });
    commands.registerCommand(DARKFACTORY_OPEN_COMMAND, {
      execute: async () => {
        await this.openView({ activate: true, reveal: true });
      },
    });
    commands.registerCommand(DARKFACTORY_OPEN_SESSION_COMMAND, {
      execute: async (sessionId: unknown) => {
        if (typeof sessionId !== "string") return;
        // Opening a session resumes it in a terminal: not in Restricted Mode, whoever asks (the pane, the Sessions part, a keybinding).
        if (!(await this.trust.getWorkspaceTrust().catch(() => false))) {
          this.messages.info("Trust this workspace to open a session in a terminal.");
          return;
        }
        const wall = await this.openView({ activate: true, reveal: true });
        wall.openSession(sessionId);
      },
    });
  }
}
