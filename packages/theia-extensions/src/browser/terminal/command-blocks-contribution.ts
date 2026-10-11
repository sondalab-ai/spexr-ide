import { inject, injectable } from "@theia/core/shared/inversify";
import { DisposableCollection } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { WidgetManager } from "@theia/core/lib/browser";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import { SPEXR_TERMINAL_COMMAND_BLOCKS_PREFERENCE } from "../preferences/spexr-preferences.js";
import { TerminalBlocks, type XtermLike } from "./command-blocks-controller.js";
import { SpexrTerminalBlocksServiceProxy, type SpexrTerminalBlocksService } from "./terminal-blocks-service-proxy.js";
import { terminalKindOf } from "./terminal-style.js";

/** Theia's switch for its shell integration: xterm's proposed API (markers, decorations) and the OSC 133 marks come with it. */
const COMMAND_HISTORY = "terminal.integrated.enableCommandHistory";

/** What a Theia terminal widget gives of its xterm. */
interface XtermHost {
  getTerminal?: () => XtermLike;
}

/** What the nonce is asked of: the widget's backend terminal id, known once its process has started. */
interface StartedTerminal {
  readonly terminalId: number;
  readonly processId: Promise<number>;
}

/**
 * Command blocks (S6l, D22) in the user's shell terminals: bash and zsh,
 * through spexr's shell scripts. Not in the agent terminal or a Dark Factory
 * session (they run a CLI, not a prompt, and get no shell integration at all),
 * and not in fish or PowerShell, which never print spexr's marks.
 *
 * Behind `spexr.terminal.commandBlocks` (default true), and needing Theia's
 * command history on: without it xterm's proposed API is closed and nothing is
 * drawn. A terminal whose xterm cannot be reached is left as it is.
 */
@injectable()
export class SpexrCommandBlocksContribution implements FrontendApplicationContribution {
  @inject(WidgetManager) private readonly widgets!: WidgetManager;
  @inject(TerminalService) private readonly terminals!: TerminalService;
  @inject(PreferenceService) private readonly preferences!: PreferenceService;
  @inject(SpexrTerminalBlocksServiceProxy) private readonly service!: SpexrTerminalBlocksService;

  private readonly attached = new Map<TerminalWidget, { blocks: TerminalBlocks; dispose: DisposableCollection }>();

  onStart(): void {
    void this.pushEnabled();
    this.widgets.onDidCreateWidget(({ widget }) => {
      if (widget instanceof TerminalWidget) this.attach(widget);
    });
    for (const widget of this.terminals.all) this.attach(widget);
    this.preferences.onPreferenceChanged((e) => {
      if (e.preferenceName === SPEXR_TERMINAL_COMMAND_BLOCKS_PREFERENCE) void this.pushEnabled();
      if (e.preferenceName === SPEXR_TERMINAL_COMMAND_BLOCKS_PREFERENCE || e.preferenceName === COMMAND_HISTORY) this.refresh();
    });
  }

  /** Tell the backend whether new shells get spexr's marks at all: the setting then really turns the feature off. */
  private async pushEnabled(): Promise<void> {
    const on = this.preferences.get<boolean>(SPEXR_TERMINAL_COMMAND_BLOCKS_PREFERENCE, true) !== false;
    await this.service.setEnabled(on).catch((err) => console.warn("[spexr] could not tell the backend about command blocks", err));
  }

  private enabled(): boolean {
    return this.preferences.get<boolean>(SPEXR_TERMINAL_COMMAND_BLOCKS_PREFERENCE, true) !== false && this.preferences.get<boolean>(COMMAND_HISTORY, false) === true;
  }

  /** Attach to the terminals that qualify, let go of the rest, and put the handler back in front where Theia has re-registered its own. */
  private refresh(): void {
    if (!this.enabled()) {
      for (const [widget] of [...this.attached]) this.detach(widget);
      return;
    }
    for (const widget of this.terminals.all) this.attach(widget);
    // Theia re-registers its own OSC handler on this change, and the widgets' listeners run after this one: the handler goes back in front on the next tick.
    setTimeout(() => {
      for (const { blocks } of this.attached.values()) blocks.hook();
    }, 0);
  }

  private attach(widget: TerminalWidget): void {
    if (this.attached.has(widget) || !this.enabled() || terminalKindOf(widget.kind) !== "editor") return;
    const xterm = (widget as unknown as XtermHost).getTerminal?.();
    if (!xterm) return;
    try {
      const dispose = new DisposableCollection();
      // The marks met so far, readable on the terminal's element: the answer to "why are there no blocks here?".
      const report = (): void => void widget.node.setAttribute("data-spexr-blocks", Object.entries(blocks.stats).map(([k, v]) => `${k}:${v}`).join(" "));
      const blocks = new TerminalBlocks(xterm, report);
      dispose.push({ dispose: () => blocks.dispose() });
      report();
      void this.learnNonce(widget, blocks, report);
      dispose.push(widget.onDidDispose(() => this.detach(widget)));
      this.attached.set(widget, { blocks, dispose });
    } catch (err) {
      // xterm's proposed API is closed for this terminal (it started before the preference was on): no blocks, no error.
      console.warn("[spexr] command blocks are not available in this terminal", err);
    }
  }

  /**
   * The shell's nonce, by the widget's backend terminal id once its process is
   * up (a window reload re-attaches to a running shell, which has the same
   * nonce). A shell with none (no spexr scripts: fish, a command run) gets no
   * blocks, and nothing in what the terminal prints can give it one.
   */
  private async learnNonce(widget: TerminalWidget, blocks: TerminalBlocks, report: () => void): Promise<void> {
    try {
      const started = widget as unknown as StartedTerminal;
      await started.processId;
      const nonce = await this.service.nonce(started.terminalId);
      if (this.attached.get(widget)?.blocks === blocks) blocks.setNonce(nonce);
      report();
    } catch {
      // The backend does not know this terminal: it has no blocks.
    }
  }

  private detach(widget: TerminalWidget): void {
    this.attached.get(widget)?.dispose.dispose();
    this.attached.delete(widget);
  }
}
