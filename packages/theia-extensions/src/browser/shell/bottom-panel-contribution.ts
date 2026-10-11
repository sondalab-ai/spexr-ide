import { inject, injectable } from "@theia/core/shared/inversify";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import { ApplicationShell } from "@theia/core/lib/browser";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import type { Command, CommandContribution, CommandRegistry } from "@theia/core";
import { nls } from "@theia/core/lib/common/nls";
import type { TabBarToolbarContribution, TabBarToolbarRegistry } from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { TerminalService } from "@theia/terminal/lib/browser/base/terminal-service";
import { TerminalWidget } from "@theia/terminal/lib/browser/base/terminal-widget";
import { ProblemManager } from "@theia/markers/lib/browser/problem/problem-manager";
import { OutputContribution } from "@theia/output/lib/browser/output-contribution";
import { PROBLEMS_VIEW_ID, bottomOrder, severityFromStat, titleFor } from "./bottom-panel.js";
import { runMigrationOnce, type MigrationStore } from "./explorer-sections.js";

/** The close-panel button's toolbar item id (S6e, B4). */
export const CLOSE_PANEL_ITEM_ID = "spexr.bottom.close-panel";

/** The command behind the button: collapse the bottom panel and hand the focus back to the editor. */
export const CLOSE_PANEL_COMMAND: Command = { id: "spexr.bottom.close", label: "Close Panel" };

/** The id the one-time Output attach is recorded under, in the left island's migration list (explorer-sections.ts). */
export const OUTPUT_ATTACH_MIGRATION_ID = "output-view-attached";

/**
 * The bottom panel, as Lumen's (S6e): its tabs in order, shell terminals
 * titled by number, the Problems chip tinted by severity, and a × that closes
 * the panel beside the terminals' "+".
 *
 * The order is put right when a widget joins the bottom and once the layout
 * has been restored (so a saved layout is ordered too); a tab the user drags
 * stays where it is dropped.
 */
@injectable()
export class SpexrBottomPanelContribution implements FrontendApplicationContribution, TabBarToolbarContribution, CommandContribution {
  @inject(ApplicationShell) private readonly shell!: ApplicationShell;
  @inject(TerminalService) private readonly terminals!: TerminalService;
  @inject(ProblemManager) private readonly problems!: ProblemManager;

  private readonly titled = new WeakSet<object>();

  onStart(): void {
    this.shell.onDidAddWidget((widget) => setTimeout(() => this.onAdded(widget), 0));
    this.problems.onDidChangeMarkers(() => this.tintProblems());
  }

  /** After the layout is restored: the saved tabs are ordered and tinted, and the saved terminals numbered. */
  onDidInitializeLayout(): void {
    for (const widget of this.shell.getWidgets("bottom")) if (widget instanceof TerminalWidget) this.titleTerminal(widget);
    this.enforceOrder();
    this.tintProblems();
  }

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(CLOSE_PANEL_COMMAND, {
      execute: async () => {
        await this.shell.collapsePanel("bottom");
        const editor = this.shell.getCurrentWidget("main");
        if (editor) await this.shell.activateWidget(editor.id);
      },
    });
  }

  registerToolbarItems(registry: TabBarToolbarRegistry): void {
    registry.registerItem({
      id: CLOSE_PANEL_ITEM_ID,
      command: CLOSE_PANEL_COMMAND.id,
      icon: "codicon codicon-close",
      tooltip: nls.localize("spexr/bottom/close", "Close Panel"),
      group: "navigation",
      priority: 1000,
      isVisible: (widget?: Widget) => !!widget && this.shell.getAreaFor(widget) === "bottom",
    });
  }

  /** A widget joined the shell: a bottom terminal gets its number, Problems its tone, and the bar's order is put right. */
  private onAdded(widget: Widget): void {
    if (this.shell.getAreaFor(widget) !== "bottom") return;
    if (widget instanceof TerminalWidget) this.titleTerminal(widget);
    if (widget.id === PROBLEMS_VIEW_ID) this.tintProblems();
    this.enforceOrder();
  }

  /**
   * Number a shell terminal nobody named (bottom-panel.ts `titleFor`). The
   * facts are Theia's: `kind`, the creator's `useServerTitle` and the protected
   * `hasUserTitle`, read through a cast.
   */
  private titleTerminal(term: TerminalWidget): void {
    if (this.titled.has(term)) return;
    this.titled.add(term);
    const facts = term as unknown as { kind?: string; hasUserTitle?: boolean; options?: { useServerTitle?: boolean } };
    const taken = this.terminals.all.filter((t) => t !== term).map((t) => t.title.label);
    const title = titleFor({ kind: facts.kind, useServerTitle: facts.options?.useServerTitle, hasUserTitle: facts.hasUserTitle }, taken);
    if (title) term.setTitle(title);
  }

  /** Terminals, Problems, Output, Agent log (bottom-panel.ts); a fixed point. */
  private enforceOrder(): void {
    for (const bar of this.shell.bottomAreaTabBars) {
      const wanted = bottomOrder(bar.titles.map((t) => t.owner.id));
      wanted.forEach((id, idx) => {
        if (bar.titles[idx]?.owner.id === id) return;
        const from = bar.titles.findIndex((t) => t.owner.id === id);
        if (from >= 0) bar.insertTab(idx, bar.titles[from]!);
      });
    }
  }

  /** Mark the Problems tab with its worst severity, as its count has it; the style sheet tints the chip from it. */
  private tintProblems(): void {
    const widget = this.shell.getWidgets("bottom").find((w) => w.id === PROBLEMS_VIEW_ID);
    if (!widget) return;
    const severity = severityFromStat(this.problems.getProblemStat());
    if (widget.title.dataset["severity"] !== severity) widget.title.dataset = { ...widget.title.dataset, severity };
  }
}

/**
 * Put the Output tab on the bar, once per workspace (D7's pattern): attached
 * behind the terminals, not in front, and not again after the user closes it.
 * Reset Layout clears the done-list, so it runs again there.
 */
@injectable()
export class SpexrOutputAttach {
  @inject(OutputContribution) private readonly output!: OutputContribution;

  attachOnce(store: MigrationStore): Promise<boolean> {
    return runMigrationOnce(store, OUTPUT_ATTACH_MIGRATION_ID, async () => {
      await this.output.openView({ activate: false, reveal: false });
    });
  }
}
