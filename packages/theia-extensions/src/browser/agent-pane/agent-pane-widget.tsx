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
import { DraftKeeper, agentDraftKey } from "./agent-pane-draft.js";

export { agentDraftKey };
import { assemblePrompt, composerState, pathFromAgentRoot, startsShellCommand } from "./agent-pane-composer-model.js";
import { planByReveal, sendByPaste, type SendPorts } from "./agent-pane-send.js";
import type { ModeReading } from "./agent-mode-footer.js";

/** How long after a keyboard send the terminal is brought forward and focused. */
const KEYBOARD_REVEAL_DELAY_MS = 400;
/** How often the agent terminal's footer is read for the permission mode. */
const FOOTER_POLL_MS = 1000;

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
  /** The unsent text, one draft per workspace (agent-pane-draft.ts). */
  private drafts!: DraftKeeper;
  /** The file chip is on: the message is led by the active file's path. Lumen shows it pressed. */
  private chipPressed = true;
  private sending = false;
  /** Theia's workspace trust; false until known, so nothing can be typed before it is. */
  private trusted = false;
  /** What the composer last told the user to do next (pasted, switch mode); cleared by the next keystroke. */
  private hint: string | undefined;
  /** The permission mode the agent's footer shows, read best-effort from the terminal buffer. */
  private footer: ModeReading | undefined;

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
    this.drafts = new DraftKeeper(
      { get: async (key) => (await this.storage.getData<string>(key)) ?? undefined, set: (key, value) => this.storage.setData(key, value) },
      () => this.update(),
    );
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
    this.toDispose.push(this.hub.onViewRequest((req) => void this.controller.view(req?.sessionId, req?.projectPath)));
    this.toDispose.push(this.client.onSnapshot$((s) => this.controller.snapshotPushed(s)));
    this.toDispose.push(this.client.onDelta$((d) => this.controller.deltaPushed(d)));
    this.toDispose.push(this.client.onSessionAdopted$(({ from, to }) => this.controller.adopted(from, to)));
    this.toDispose.push(
      this.terminal.onDidChangeSession(() => {
        void this.drafts.switchRoot(this.terminal.agentRootUri());
        // A new agent session is what the pane shows again, whatever it was looking at.
        this.hub.requestView(undefined);
      }),
    );
    this.toDispose.push(this.editors.onCurrentEditorChanged(() => this.update()));
    this.toDispose.push({ dispose: () => this.drafts.dispose() });
    const footerTimer = setInterval(() => this.readFooter(), FOOTER_POLL_MS);
    this.toDispose.push({ dispose: () => clearInterval(footerTimer) });
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
    void this.drafts.switchRoot(this.terminal.agentRootUri());
    this.toDispose.push({
      dispose: () => {
        this.controller.dispose();
        this.hub.clearPending();
        this.hub.publish({ followed: undefined, viewing: false, snapshot: undefined });
      },
    });
    // Opened by a click in the Sessions part: it follows that session from the start.
    void this.controller.view(this.hub.pendingView?.sessionId, this.hub.pendingView?.projectPath);
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

  /**
   * The active editor's file: its name for the chip and its path from the
   * agent's own folder for the message (the folder Claude Code resolves an
   * `@path` from, which is not always the workspace root the file lies in).
   * Undefined with no editor, or a file the agent's folder does not hold.
   */
  private activeFile(): { name: string; path: string } | undefined {
    const uri = this.editors.currentEditor?.getResourceUri();
    const rootUri = this.terminal.agentRootUri();
    if (!uri || !rootUri) return undefined;
    const path = pathFromAgentRoot(new URI(rootUri).path.toString(), uri.path.toString());
    return path ? { name: uri.path.base, path } : undefined;
  }

  /** Read the footer, and draw again only when the mode it shows has changed. */
  private readFooter(): void {
    if (!this.isVisible) return;
    const now = this.terminal.agentModeFooter();
    if (JSON.stringify(now) === JSON.stringify(this.footer)) return;
    this.footer = now;
    this.update();
  }

  private setDraft(text: string): void {
    this.hint = undefined;
    this.drafts.set(text);
  }

  /** The agent terminal as Send and Plan drive it: a paste, and bringing the terminal forward. Nothing else. */
  private ports(revealDelayMs = 0): SendPorts {
    return {
      trusted: () => this.terminal.isTrusted(),
      running: () => this.terminal.isRunning(),
      start: () => this.terminal.ensureStarted(),
      ready: () => this.terminal.whenReady(),
      paste: (text) => this.terminal.pasteIntoAgent(text),
      // After a keyboard send the terminal takes focus only after a pause: a reflex second Enter must not submit what was not read.
      reveal: async () => {
        if (revealDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, revealDelayMs));
        await this.terminal.reveal();
      },
    };
  }

  /**
   * Send the draft: one bracketed paste into the agent's input, never an
   * Enter (agent-pane-send.ts). The terminal is brought forward and the person
   * presses Enter there. The draft is cleared only if the paste went in and
   * the field still holds what was sent, so words typed meanwhile survive.
   */
  private async send(viaKeyboard: boolean): Promise<void> {
    const file = this.chipPressed ? this.activeFile() : undefined;
    const prompt = assemblePrompt(this.drafts.text, file?.path);
    if (!prompt || this.sending) return;
    const sent = this.drafts.text;
    this.sending = true;
    this.update();
    try {
      const outcome = await sendByPaste(prompt, this.ports(viaKeyboard ? KEYBOARD_REVEAL_DELAY_MS : 0));
      if (outcome === "pasted" || outcome === "pasted-after-start") {
        // A fresh launch may have shown a dialog of its own that took the paste: the text stays, to paste again.
        if (outcome === "pasted") this.drafts.clearIfUnchanged(sent);
        this.hint = nls.localize("spexr/agentPane/pasted", "Pasted into the agent: press Enter in the terminal to send.");
      } else if (outcome === "untrusted") {
        this.messages.info(nls.localize("spexr/agentPane/trust", "Trust this workspace to start the agent."));
      }
    } catch (err) {
      this.messages.warn(nls.localize("spexr/agentPane/notSent", "The message was not sent: {0}", err instanceof Error ? err.message : String(err)));
    } finally {
      this.sending = false;
      this.update();
    }
  }

  /** Plan: bring the agent's terminal forward, where Shift+Tab switches the mode. Nothing is typed. */
  private async plan(): Promise<void> {
    try {
      const outcome = await planByReveal(this.ports());
      if (outcome === "revealed") this.hint = nls.localize("spexr/agentPane/planHint", "Switch mode with Shift+Tab in the terminal.");
      this.update();
    } catch (err) {
      this.messages.warn(nls.localize("spexr/agentPane/planFailed", "The agent's terminal could not be shown: {0}", err instanceof Error ? err.message : String(err)));
    }
  }

  /** A follow that failed is tried again whenever the pane comes into view. */
  protected override onAfterShow(msg: Message): void {
    super.onAfterShow(msg);
    void this.controller.bind();
  }

  private composer(): React.ReactNode {
    const file = this.activeFile();
    const state = composerState({
      draft: this.drafts.text,
      running: this.terminal.isRunning(),
      trusted: this.trusted,
      ownSession: this.controller.viewing === undefined,
      sending: this.sending,
    });
    return (
      <AgentPaneComposer
        draft={this.drafts.text}
        onDraft={(text) => this.setDraft(text)}
        file={file}
        chipPressed={this.chipPressed}
        onChip={() => {
          this.chipPressed = !this.chipPressed;
          this.update();
        }}
        planPressed={this.footer?.kind === "mode" && this.footer.mode === "plan"}
        autoApprove={this.footer?.kind === "mode" && this.footer.autoApprove}
        modeUnknown={this.footer?.kind !== "mode"}
        hint={this.hint ?? (startsShellCommand(assemblePrompt(this.drafts.text, this.chipPressed ? file?.path : undefined)) ? nls.localize("spexr/agentPane/shellCommand", "Starts a shell command in Claude.") : undefined)}
        state={state}
        onSend={(viaKeyboard) => void this.send(viaKeyboard)}
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
        loading={snapshot === undefined && this.controller.followed !== undefined}
        expanded={this.controller.expanded}
        onToggleExpanded={() => this.controller.toggleExpanded()}
        onReveal={() => void this.terminal.reveal()}
        composer={this.composer()}
      />
    );
  }
}
