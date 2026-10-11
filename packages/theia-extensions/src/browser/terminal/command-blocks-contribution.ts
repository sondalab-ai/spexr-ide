import { inject, injectable } from "@theia/core/shared/inversify";
import { DisposableCollection } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { WidgetManager } from "@theia/core/lib/browser";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import { SPEXR_TERMINAL_COMMAND_BLOCKS_PREFERENCE } from "../preferences/spexr-preferences.js";
import { TerminalBlocks, type XtermLike } from "./command-blocks-controller.js";
import { terminalKindOf } from "./terminal-style.js";

/** Theia's switch for its shell integration: xterm's proposed API (markers, decorations) and the OSC 133 marks come with it. */
const COMMAND_HISTORY = "terminal.integrated.enableCommandHistory";

/** What a Theia terminal widget gives of its xterm. */
interface XtermHost {
  getTerminal?: () => XtermLike;
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

  private readonly attached = new Map<TerminalWidget, { blocks: TerminalBlocks; dispose: DisposableCollection }>();

  onStart(): void {
    this.widgets.onDidCreateWidget(({ widget }) => {
      if (widget instanceof TerminalWidget) this.attach(widget);
    });
    for (const widget of this.terminals.all) this.attach(widget);
    this.preferences.onPreferenceChanged((e) => {
      if (e.preferenceName === SPEXR_TERMINAL_COMMAND_BLOCKS_PREFERENCE || e.preferenceName === COMMAND_HISTORY) this.refresh();
    });
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
    for (const { blocks } of this.attached.values()) blocks.hook();
  }

  private attach(widget: TerminalWidget): void {
    if (this.attached.has(widget) || !this.enabled() || terminalKindOf(widget.kind) !== "editor") return;
    const xterm = (widget as unknown as XtermHost).getTerminal?.();
    if (!xterm) return;
    try {
      const dispose = new DisposableCollection();
      const blocks = new TerminalBlocks(xterm);
      dispose.push({ dispose: () => blocks.dispose() });
      // The marks met so far, readable on the terminal's element: the answer to "why are there no blocks here?".
      const report = (): void => void widget.node.setAttribute("data-spexr-blocks", Object.entries(blocks.stats).map(([k, v]) => `${k}:${v}`).join(" "));
      report();
      const timer = setInterval(report, 1000);
      dispose.push({ dispose: () => clearInterval(timer) });
      dispose.push(widget.onDidDispose(() => this.detach(widget)));
      this.attached.set(widget, { blocks, dispose });
    } catch (err) {
      // xterm's proposed API is closed for this terminal (it started before the preference was on): no blocks, no error.
      console.warn("[spexr] command blocks are not available in this terminal", err);
    }
  }

  private detach(widget: TerminalWidget): void {
    this.attached.get(widget)?.dispose.dispose();
    this.attached.delete(widget);
  }
}
