import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser";
import { StorageService } from "@theia/core/lib/browser/storage-service";
import { MessageService } from "@theia/core/lib/common/message-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { EditorManager } from "@theia/editor/lib/browser";
import { nls } from "@theia/core/lib/common/nls";
import URI from "@theia/core/lib/common/uri";
import { applyDelta } from "../../common/agent-pane-apply.js";
import type { AgentPaneService, AgentPaneSnapshot } from "../../common/agent-pane-protocol.js";
import { AgentPaneClientDispatcher, AgentPaneServiceProxy } from "../agent/agent-pane-client.js";
import { ClaudeTerminalManager } from "../agent/claude-terminal-manager.js";
import { AGENT_PANE_VIEW_ID } from "./agent-pane-view-contribution.js";
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

  private snapshot: AgentPaneSnapshot | undefined;
  /** The session the backend is asked to follow; deltas and snapshots of any other are late and dropped. */
  private followed: string | undefined;
  private expanded = false;
  private draft = "";
  /** The root whose draft is in the field: a draft is loaded once per workspace and written back as it changes. */
  private draftRoot: string | undefined;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
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
    this.toDispose.push(
      this.client.onSnapshot$((s) => {
        if (s.sessionId !== this.followed) return;
        this.snapshot = s;
        this.update();
      }),
    );
    this.toDispose.push(
      this.client.onDelta$((d) => {
        if (d.sessionId !== this.followed || !this.snapshot) return;
        this.snapshot = applyDelta(this.snapshot, d);
        this.update();
      }),
    );
    this.toDispose.push(
      this.client.onSessionAdopted$(({ from, to }) => {
        if (from !== this.followed) return;
        this.followed = to;
        // The conversation moved on (/clear, /resume): it is the agent's session now, and a reload follows it.
        const root = this.terminal.agentRootUri();
        if (root) this.terminal.adoptSessionId(root, to);
        this.snapshot = undefined;
        this.update();
      }),
    );
    this.toDispose.push(this.terminal.onDidChangeSession(() => void this.bind()));
    this.toDispose.push(this.editors.onCurrentEditorChanged(() => this.update()));
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
    this.toDispose.push({ dispose: () => this.flushDraft() });
    this.toDispose.push({ dispose: () => void this.service.stop().catch(() => undefined) });
    void this.bind();
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

  /** Follow the agent terminal's session, or show the empty state when it has none. */
  private async bind(): Promise<void> {
    const rootUri = this.terminal.agentRootUri();
    void this.loadDraft(rootUri);
    const running = this.terminal.currentSessionId();
    const sessionId = running ?? (rootUri ? await this.terminal.storedSessionId(rootUri) : undefined);
    if (!rootUri || !sessionId) {
      this.followed = undefined;
      this.snapshot = undefined;
      this.update();
      await this.service.stop().catch(() => undefined);
      return;
    }
    if (sessionId === this.followed) return;
    this.followed = sessionId;
    this.snapshot = undefined;
    this.update();
    try {
      const first = await this.service.follow({
        sessionId,
        workspacePath: new URI(rootUri).path.fsPath(),
        // An id from storage may be a session that ended: the backend then adopts a newer transcript only while a Claude runs there.
        ...(running ? {} : { fromStorage: true }),
      });
      if (first && this.followed === sessionId && !this.snapshot) {
        this.snapshot = first;
        this.update();
      }
    } catch (err) {
      console.warn("[spexr] the agent pane could not follow its session", err);
    }
  }

  protected render(): React.ReactNode {
    const file = this.activeFile();
    const state = composerState({
      draft: this.draft,
      running: this.terminal.isRunning(),
      phase: this.snapshot?.phase,
      trusted: this.trusted,
      ownSession: this.ownSession,
      sending: this.sending,
    });
    return (
      <AgentPaneView
        snapshot={this.snapshot}
        expanded={this.expanded}
        onToggleExpanded={() => {
          this.expanded = !this.expanded;
          this.update();
        }}
        onReveal={() => void this.terminal.reveal()}
        composer={
          <AgentPaneComposer
            draft={this.draft}
            onDraft={(text) => this.setDraft(text)}
            file={file}
            chipPressed={this.chipPressed}
            onChip={() => {
              this.chipPressed = !this.chipPressed;
              this.update();
            }}
            planPressed={this.snapshot?.planMode === true}
            state={state}
            onSend={() => void this.send()}
            onPlan={() => void this.plan()}
            onOpenInTerminal={() => void this.terminal.reveal()}
          />
        }
      />
    );
  }
}
