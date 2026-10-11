import { inject, injectable } from "@theia/core/shared/inversify";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import { ApplicationShell } from "@theia/core/lib/browser";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { WidgetManager } from "@theia/core/lib/browser/widget-manager";
import { CommonCommands } from "@theia/core/lib/browser/common-commands";
import type { TabBarToolbarContribution, TabBarToolbarRegistry } from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import { ProblemManager } from "@theia/markers/lib/browser/problem/problem-manager";
import { OutputContribution } from "@theia/output/lib/browser/output-contribution";
import { CLAUDE_TERMINAL_ID } from "../agent/claude-terminal-id.js";
import type { RevealOnRestoreView } from "./reveal-on-restore.js";
import { PROBLEMS_VIEW_ID, bottomOrder, isNumberedTerminalTitle, nextTerminalTitle, problemSeverity } from "./bottom-panel.js";

/** The close-panel button's toolbar item id (S6e, B4). */
export const CLOSE_PANEL_ITEM_ID = "spexr.bottom.close-panel";

/**
 * The bottom panel, as Lumen's (S6e): its tabs in order, shell terminals
 * titled by number, the Problems chip tinted by severity, and a × that
 * closes the panel beside the terminals' "+".
 */
@injectable()
export class SpexrBottomPanelContribution implements FrontendApplicationContribution, TabBarToolbarContribution {
  @inject(ApplicationShell) private readonly shell!: ApplicationShell;
  @inject(WidgetManager) private readonly widgets!: WidgetManager;
  @inject(ProblemManager) private readonly problems!: ProblemManager;

  private enforcing = false;
  private readonly watched = new WeakSet<object>();

  onStart(): void {
    this.shell.onDidAddWidget((widget) => setTimeout(() => this.onAdded(widget), 0));
    this.problems.onDidChangeMarkers(() => this.tintProblems());
    this.widgets.onDidCreateWidget(({ widget }) => widget.id === PROBLEMS_VIEW_ID && this.tintProblems());
    this.tintProblems();
  }

  registerToolbarItems(registry: TabBarToolbarRegistry): void {
    registry.registerItem({
      id: CLOSE_PANEL_ITEM_ID,
      command: CommonCommands.TOGGLE_BOTTOM_PANEL.id,
      icon: "codicon codicon-close",
      tooltip: "Close panel",
      group: "navigation",
      priority: 1000,
      isVisible: (widget?: Widget) => !!widget && this.shell.getAreaFor(widget) === "bottom",
    });
  }

  /** A widget joined the shell: a bottom terminal gets its number, and the bar's order is put right. */
  private onAdded(widget: Widget): void {
    if (this.shell.getAreaFor(widget) !== "bottom") return;
    if (widget instanceof TerminalWidget && widget.id !== CLAUDE_TERMINAL_ID) this.titleTerminal(widget);
    this.enforceOrder();
  }

  /** Give a shell terminal the next free number, unless the user named it (Theia keeps `hasUserTitle`, which is protected, so it is read through a cast) or it is already numbered. */
  private titleTerminal(term: TerminalWidget): void {
    if (this.watched.has(term) || (term as unknown as { hasUserTitle?: boolean }).hasUserTitle) return;
    this.watched.add(term);
    const taken = this.shell.getWidgets("bottom").filter((w): w is TerminalWidget => w instanceof TerminalWidget && w !== term).map((w) => w.title.label);
    if (isNumberedTerminalTitle(term.title.label) && !taken.includes(term.title.label)) return;
    term.setTitle(nextTerminalTitle(taken));
  }

  /** Terminals, Problems, Output, Agent log (bottom-panel.ts); a fixed point, so the re-order it causes ends here. */
  private enforceOrder(): void {
    if (this.enforcing) return;
    this.enforcing = true;
    try {
      for (const bar of this.shell.bottomAreaTabBars) {
        if (!this.watched.has(bar)) {
          this.watched.add(bar);
          bar.tabMoved.connect(() => setTimeout(() => this.enforceOrder(), 0));
        }
        const wanted = bottomOrder(bar.titles.map((t) => t.owner.id));
        wanted.forEach((id, idx) => {
          if (bar.titles[idx]?.owner.id === id) return;
          const from = bar.titles.findIndex((t) => t.owner.id === id);
          if (from >= 0) bar.insertTab(idx, bar.titles[from]!);
        });
      }
    } finally {
      this.enforcing = false;
    }
  }

  /** Mark the Problems tab with its worst severity; the style sheet tints the count chip from it. */
  private tintProblems(): void {
    const widget = this.shell.getWidgets("bottom").find((w) => w.id === PROBLEMS_VIEW_ID);
    if (!widget) return;
    const severity = problemSeverity(this.problems.findMarkers().map((m) => ({ severity: m.data.severity })));
    if (widget.title.dataset["severity"] !== severity) widget.title.dataset = { ...widget.title.dataset, severity };
  }
}

/** Output, attached behind the terminals at a restore so its tab is on the bar by default without taking the front. */
@injectable()
export class SpexrOutputRevealView implements RevealOnRestoreView {
  @inject(OutputContribution) private readonly output!: OutputContribution;
  readonly attachBehind = true;

  openView(options?: { activate?: boolean; reveal?: boolean }): Promise<unknown> {
    return this.output.openView(options);
  }
}
