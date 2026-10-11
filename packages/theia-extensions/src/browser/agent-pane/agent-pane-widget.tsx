import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { StorageService } from "@theia/core/lib/browser/storage-service";
import { MessageService } from "@theia/core/lib/common/message-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { EditorManager } from "@theia/editor/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import type { AgentPaneService } from "../../common/agent-pane-protocol.js";
import { AgentPaneClientDispatcher, AgentPaneServiceProxy } from "../agent/agent-pane-client.js";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import { AGENT_PANE_VIEW_ID } from "./agent-pane-view-contribution.js";
import { AgentPaneController } from "./agent-pane-controller.js";
import { AgentFollowHub } from "./agent-follow-hub.js";
import { DARKFACTORY_OPEN_SESSION_COMMAND } from "../darkfactory/darkfactory-open-session.js";
import { AgentPaneView } from "./agent-pane-view.js";
import { AgentPaneComposer } from "./agent-pane-composer.js";
import { assemblePrompt, composerState } from "./agent-pane-composer-model.js";
import { guardedPlanToggle, guardedSend, type GuardPorts } from "./agent-pane-guard.js";

/** The storage key of a workspace's unsent draft. */
export const agentDraftKey = (rootUri: string): string => `spexr.agent.draft:${rootUri}`;
/** How long after the last keystroke the draft is kept. */
const DRAFT_SAVE_MS = 400;

/**
 * The agent pane (read-only): what the followed Claude session is doing, as
 * the backend's AgentPaneService reports it. The session is the one the agent
 * terminal was started with (`--session-id`); the pane follows it from the
 * moment it is known, follows it to its successor after /clear or /resume,
 * and has an empty state while there is none. Updates arrive per transcript
 * record, so the pane moves in steps, not token by token.
 */
@injectable()
export class AgentPaneWidget extends ReactWidget {
  static readonly ID = AGENT_PANE_VIEW_ID;

  @inject(AgentPaneServiceProxy) private readonly service!: AgentPaneService;
  @inject(AgentPaneClientDispatcher) private readonly client!: AgentPaneClientDispatcher;
  @inject(ClaudeTerminalManager) private readonly terminal!: ClaudeTerminalManager;
  @inject(StorageService) private readonly storage!: StorageService;
  @inject(MessageService) private readonly messages!: MessageService;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(EditorManager) private readonly editors!: EditorManager;
  @inject(AgentFollowHub) private readonly hub!: AgentFollowHub;
  @inject(CommandService) private readonly commands!: CommandService;

  /** Which session the pane follows and what it holds of it: see AgentPaneController. */
  private controller!: AgentPaneController;
  private draft = "";
  /** The root whose draft is in the field: a draft is loaded once per workspace and written back as it changes. */
  private draftRoot: string | undefined;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  /** The file chip is on: the message is led by the active file's path. Lumen shows it pressed. */
  private chipPressed = true;
  private sending = false;
  /** Theia's workspace trust; false until known, so nothing can be typed before it is. */
  private trusted = false;

  constructor() {
    super();
    this.id = AgentPaneWidget.ID;
    this.title.label = nls.localize("spexr/agentPane/title", "Agent");
    this.title.caption = nls.localize("spexr/agentPane/caption", "What the agent is doing");
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-sparkle";
    this.addClass("spexr-agent-pane-widget");
  }

  @postConstruct()
  protected init(): void {
    this.controller = new AgentPaneController(
      this.service,
      this.terminal,
      (rootUri) => new URI(rootUri).path.fsPath(),
      () => {
        this.update();
        this.publish();
      },
      (message, error) => console.warn(`[spexr] ${message}`, error),
    );
    this.toDispose.push(this.hub.onViewRequest((id) => void this.controller.view(id)));
    this.toDispose.push(this.client.onSnapshot$((s) => this.controller.snapshotPushed(s)));
    this.toDispose.push(this.client.onDelta$((d) => this.controller.deltaPushed(d)));
    this.toDispose.push(this.client.onSessionAdopted$(({ from, to }) => this.controller.adopted(from, to)));
    this.toDispose.push(
      this.terminal.onDidChangeSession(() => {
        void this.loadDraft(this.terminal.agentRootUri());
        // A new agent session is what the pane shows again, whatever it was looking at.
        this.hub.requestView(undefined);
      }),
    );
    this.toDispose.push(this.editors.onCurrentEditorChanged(() => this.update()));
    this.toDispose.push({ dispose: () => this.flushDraft() });
    void this.terminal.isTrusted().then((t) => {
      this.trusted = t;
      this.update();
    });
    this.toDispose.push(
      this.terminal.onDidChangeTrust((t) => {
        this.trusted = t;
        this.update();
      }),
    );
    void this.loadDraft(this.terminal.agentRootUri());
    this.toDispose.push({
      dispose: () => {
        this.controller.dispose();
        this.hub.publish({ followed: undefined, viewing: false, snapshot: undefined });
      },
    });
    // Opened by a click in the Sessions part: it follows that session from the start.
    void this.controller.view(this.hub.pendingView);
  }

  /** Say what the pane follows, for the Sessions part, the Agent log and the status bar. */
  private publish(): void {
    this.hub.publish({ followed: this.controller.followed, viewing: this.controller.viewing !== undefined, snapshot: this.controller.snapshot });
  }

  /**
   * The composer's "Open in terminal" for a session that is not the agent's:
   * Dark Factory's own flow opens it (a resume in a card, or a read-only
   * follow with Fork when it runs elsewhere). Nothing starts in a workspace
   * that is not trusted.
   */
  private async openFollowedInTerminal(): Promise<void> {
    const id = this.controller.followed;
    if (!id) return;
    if (!(await this.terminal.isTrusted())) {
      this.messages.info(nls.localize("spexr/agentPane/trustResume", "Trust this workspace to open a session in a terminal."));
      return;
    }
    await this.commands.executeCommand(DARKFACTORY_OPEN_SESSION_COMMAND.id, id);
  }

  /** The active editor's file: its name for the chip, its workspace-relative path for the message. */
  private activeFile(): { name: string; path: string } | undefined {
    const uri = this.editors.currentEditor?.getResourceUri();
    if (!uri) return undefined;
    const root = this.workspace.getWorkspaceRootUri(uri);
    const path = root?.relative(uri)?.toString();
    return path ? { name: uri.path.base, path } : undefined;
  }

  /** Load the workspace's unsent draft the first time its root is known. */
  private async loadDraft(rootUri: string | undefined): Promise<void> {
    if (!rootUri || this.draftRoot === rootUri) return;
    this.flushDraft();
    this.draftRoot = rootUri;
    try {
      const saved = await this.storage.getData<string>(agentDraftKey(rootUri));
      if (typeof saved === "string" && this.draftRoot === rootUri && this.draft === "") {
        this.draft = saved;
        this.update();
      }
    } catch {
      /* storage unavailable: the draft starts empty */
    }
  }

  private setDraft(text: string): void {
    this.draft = text;
    this.update();
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => this.flushDraft(), DRAFT_SAVE_MS);
  }

  private flushDraft(): void {
    if (this.draftTimer) clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    if (!this.draftRoot) return;
    void this.storage.setData(agentDraftKey(this.draftRoot), this.draft).catch(() => undefined);
  }

  /** The agent terminal as the guards drive it. */
  private ports(): GuardPorts {
    return {
      trusted: () => this.terminal.isTrusted(),
      running: () => this.terminal.isRunning(),
      start: () => this.terminal.ensureStarted(),
      checkpoint: () => this.service.readPhase().catch(() => undefined),
      paste: (text) => this.terminal.pasteIntoAgent(text),
      submit: () => this.terminal.submitAgentInput(),
      cycleMode: () => this.terminal.cycleAgentMode(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    };
  }

  /**
   * Send the draft, only to an idle agent (agent-pane-guard.ts): the transcript
   * is read before the text is typed and again before Enter, and with no agent
   * running the agent is only started.
   */
  private async send(): Promise<void> {
    const file = this.chipPressed ? this.activeFile() : undefined;
    const prompt = assemblePrompt(this.draft, file?.path);
    if (!prompt || this.sending) return;
    this.sending = true;
    this.update();
    try {
      const outcome = await guardedSend(prompt, this.ports());
      if (outcome === "sent") this.setDraft("");
      else if (outcome === "started") this.messages.info(nls.localize("spexr/agentPane/started", "The agent is starting. Send your message when it is ready."));
      else if (outcome === "busy") this.messages.warn(nls.localize("spexr/agentPane/busy", "The agent is working. Your message was not sent."));
      else if (outcome === "raced") this.messages.warn(nls.localize("spexr/agentPane/raced", "The agent became busy: your message is in its input, not submitted. Press Enter in the terminal when it is ready."));
      else this.messages.info(nls.localize("spexr/agentPane/trust", "Trust this workspace to start the agent."));
    } catch (err) {
      this.messages.warn(`The message was not sent: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.sending = false;
      this.update();
    }
  }

  /** Plan: Shift+Tab one press at a time, the mode read back each time, never left in a mode that does not ask. */
  private async plan(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    this.update();
    try {
      const outcome = await guardedPlanToggle(this.ports());
      if (!outcome.ok) {
        const note = outcome.unsafe
          ? ` The session is in ${outcome.mode}, which does not ask before acting: press Shift+Tab in the terminal until it says plan or default.`
          : "";
        this.messages.warn(`Plan mode was not changed (${outcome.reason}).${note}`);
      }
    } catch (err) {
      this.messages.warn(`Plan mode was not changed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.sending = false;
      this.update();
    }
  }

  /** A follow that failed is tried again whenever the pane comes into view. */
  protected override onAfterShow(msg: Message): void {
    super.onAfterShow(msg);
    void this.controller.bind();
  }

  private composer(): React.ReactNode {
    const file = this.activeFile();
    const snapshot = this.controller.snapshot;
    const state = composerState({
      draft: this.draft,
      running: this.terminal.isRunning(),
      phase: snapshot?.phase,
      trusted: this.trusted,
      ownSession: this.controller.viewing === undefined,
      sending: this.sending,
    });
    return (
      <AgentPaneComposer
        draft={this.draft}
        onDraft={(text) => this.setDraft(text)}
        file={file}
        chipPressed={this.chipPressed}
        onChip={() => {
          this.chipPressed = !this.chipPressed;
          this.update();
        }}
        planPressed={snapshot?.planMode === true}
        state={state}
        onSend={() => void this.send()}
        onPlan={() => void this.plan()}
        onOpenInTerminal={() => void (this.controller.viewing === undefined ? this.terminal.reveal() : this.openFollowedInTerminal())}
      />
    );
  }

  protected render(): React.ReactNode {
    const snapshot = this.controller.snapshot;
    // "Waiting for you in the terminal" is about the agent's terminal: another session's wait is not asked of it.
    const shown = snapshot && this.controller.viewing !== undefined && snapshot.needsYou ? { ...snapshot, needsYou: false } : snapshot;
    return (
      <AgentPaneView
        snapshot={shown}
        expanded={this.controller.expanded}
        onToggleExpanded={() => this.controller.toggleExpanded()}
        onReveal={() => void this.terminal.reveal()}
        composer={this.composer()}
      />
    );
  }
}
