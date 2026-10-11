import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
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
import { AgentPaneView } from "./agent-pane-view.js";
import { AgentPaneComposer } from "./agent-pane-composer.js";
import { DraftKeeper, agentDraftKey } from "./agent-pane-draft.js";

export { agentDraftKey };
import { assemblePrompt, composerState, pathFromAgentRoot, startsShellCommand } from "./agent-pane-composer-model.js";
import { planByReveal, sendByPaste, type SendPorts } from "./agent-pane-send.js";
import type { ModeFooter } from "./agent-mode-footer.js";

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

  /** Which session the pane follows and what it holds of it: see AgentPaneController. */
  private controller!: AgentPaneController;
  /** The unsent text, one draft per workspace (agent-pane-draft.ts). */
  private drafts!: DraftKeeper;
  /** The file chip is on: the message is led by the active file's path. Lumen shows it pressed. */
  private chipPressed = true;
  private sending = false;
  /** Theia's workspace trust; false until known, so nothing can be typed before it is. */
  private trusted = false;
  /**
   * False when the pane follows a session that is not the agent terminal's own
   * (S6j's read-only follows set it): the composer then only offers to open it.
   */
  private ownSession = true;
  /** What the composer last told the user to do next (pasted, switch mode); cleared by the next keystroke. */
  private hint: string | undefined;
  /** The permission mode the agent's footer shows, read best-effort from the terminal buffer. */
  private footer: ModeFooter | undefined;

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
      () => this.update(),
      (message, error) => console.warn(`[spexr] ${message}`, error),
    );
    this.toDispose.push(this.client.onSnapshot$((s) => this.controller.snapshotPushed(s)));
    this.toDispose.push(this.client.onDelta$((d) => this.controller.deltaPushed(d)));
    this.toDispose.push(this.client.onSessionAdopted$(({ from, to }) => this.controller.adopted(from, to)));
    this.toDispose.push(
      this.terminal.onDidChangeSession(() => {
        void this.drafts.switchRoot(this.terminal.agentRootUri());
        void this.controller.bind();
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
    this.toDispose.push({ dispose: () => this.controller.dispose() });
    void this.controller.bind();
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
    if (now?.mode === this.footer?.mode) return;
    this.footer = now;
    this.update();
  }

  private setDraft(text: string): void {
    this.hint = undefined;
    this.drafts.set(text);
  }

  /** The agent terminal as Send and Plan drive it: a paste, and bringing the terminal forward. Nothing else. */
  private ports(): SendPorts {
    return {
      trusted: () => this.terminal.isTrusted(),
      running: () => this.terminal.isRunning(),
      start: () => this.terminal.ensureStarted(),
      ready: () => this.terminal.whenReady(),
      paste: (text) => this.terminal.pasteIntoAgent(text),
      reveal: () => this.terminal.reveal(),
    };
  }

  /**
   * Send the draft: one bracketed paste into the agent's input, never an
   * Enter (agent-pane-send.ts). The terminal is brought forward and the person
   * presses Enter there. The draft is cleared only if the paste went in and
   * the field still holds what was sent, so words typed meanwhile survive.
   */
  private async send(): Promise<void> {
    const file = this.chipPressed ? this.activeFile() : undefined;
    const prompt = assemblePrompt(this.drafts.text, file?.path);
    if (!prompt || this.sending) return;
    const sent = this.drafts.text;
    this.sending = true;
    this.update();
    try {
      const outcome = await sendByPaste(prompt, this.ports());
      if (outcome === "pasted") {
        this.drafts.clearIfUnchanged(sent);
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
      ownSession: this.ownSession,
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
        planPressed={this.footer?.mode === "plan"}
        autoApprove={this.footer?.autoApprove === true}
        hint={this.hint ?? (startsShellCommand(assemblePrompt(this.drafts.text, this.chipPressed ? file?.path : undefined)) ? nls.localize("spexr/agentPane/shellCommand", "Starts a shell command in Claude.") : undefined)}
        state={state}
        onSend={() => void this.send()}
        onPlan={() => void this.plan()}
        onOpenInTerminal={() => void this.terminal.reveal()}
      />
    );
  }

  protected render(): React.ReactNode {
    return (
      <AgentPaneView
        snapshot={this.controller.snapshot}
        expanded={this.controller.expanded}
        onToggleExpanded={() => this.controller.toggleExpanded()}
        onReveal={() => void this.terminal.reveal()}
        composer={this.composer()}
      />
    );
  }
}
