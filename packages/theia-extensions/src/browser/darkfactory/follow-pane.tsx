import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import type { FollowEvent, SpexrDarkfactoryService } from "../../common/darkfactory-protocol.js";
import { SpexrDarkfactoryServiceProxy } from "./darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "./darkfactory-client.js";
import { SpexrDarkfactoryTerminalManager } from "./darkfactory-terminal-manager.js";
import { FollowTranscript } from "./agent-tile.js";

/** Cap the follow buffer so a long-running session cannot grow it without bound. */
const FOLLOW_BUFFER = 400;

/** Read-only live view of one session's transcript, for agents live elsewhere. */
@injectable()
export class SpexrDarkfactoryFollowWidget extends ReactWidget {
  static readonly ID = "spexr.view.darkfactory.follow";

  @inject(SpexrDarkfactoryServiceProxy) private readonly service!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly client!: SpexrDarkfactoryClientDispatcher;
  @inject(SpexrDarkfactoryTerminalManager) private readonly terminals!: SpexrDarkfactoryTerminalManager;

  private sessionId: string | undefined;
  private projectPath = "";
  private configDir = "";
  private projectName = "";
  private events: FollowEvent[] = [];

  @postConstruct()
  protected init(): void {
    this.id = SpexrDarkfactoryFollowWidget.ID;
    this.title.label = "Following";
    this.title.caption = "Read-only agent follow";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-eye";
    this.addClass("spexr-df-follow");
    this.toDispose.push(
      this.client.onFollowChunk$(({ sessionId, events }) => {
        if (sessionId !== this.sessionId) return;
        this.events = [...this.events, ...events].slice(-FOLLOW_BUFFER);
        this.update();
      }),
    );
    this.toDispose.push({ dispose: () => this.stopCurrent() });
  }

  /** Re-target the pane to a session; stops the previous follow. */
  async follow(sessionId: string, projectPath: string, configDir: string, projectName: string): Promise<void> {
    if (this.sessionId === sessionId) return;
    this.stopCurrent();
    this.sessionId = sessionId;
    this.projectPath = projectPath;
    this.configDir = configDir;
    this.projectName = projectName;
    this.events = [];
    this.update();
    await this.service.startFollow(sessionId).catch(() => {
      /* ignore */
    });
  }

  private stopCurrent(): void {
    if (this.sessionId) {
      void this.service.stopFollow(this.sessionId).catch(() => {
        /* ignore */
      });
    }
  }

  protected render(): React.ReactNode {
    if (!this.sessionId) {
      return <div className="spexr-df-follow__empty">Select a live agent to follow.</div>;
    }
    return (
      <div className="spexr-df-follow__root">
        <header className="spexr-df-follow__head">
          <span className="spexr-df-follow__project">{this.projectName}</span>
          <span className="spexr-df-follow__tag">read-only follow</span>
          <button
            className="spexr-button spexr-button--primary"
            onClick={() =>
              this.sessionId &&
              void this.terminals
                .openResume(this.sessionId, this.projectPath, this.configDir, true)
                .catch(() => {})
            }
          >
            Fork &amp; take over
          </button>
        </header>
        <div className="spexr-df-follow__scroll">
          <FollowTranscript events={this.events} />
        </div>
      </div>
    );
  }
}
