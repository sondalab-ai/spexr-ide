import { inject, injectable, named } from "@theia/core/shared/inversify";
import { ContributionProvider, Prioritizeable, type Command, type CommandContribution, type CommandRegistry } from "@theia/core";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import type {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { EditorWidget } from "@theia/editor/lib/browser/editor-widget";
import { SplitEditorContribution } from "@theia/editor/lib/browser/split-editor-contribution";

/** The toolbar item's id: the main tab bar's split button (S6c, E5). */
export const SPLIT_TOOLBAR_ITEM_ID = "spexr.editor.split.toolbar";

/** The command behind the button: split the editor the toolbar belongs to, to the right. */
export const SPLIT_TOOLBAR_COMMAND: Command = { id: "spexr.editor.splitRight", label: "Split Editor Right (this tab bar's editor)" };

/**
 * A split button at the right end of the editor strip, as Lumen's "Split":
 * it opens the editor again to the right. It is shown only while an editor is
 * the tab bar's current tab, so Welcome, Specs and the agents' wall carry no
 * button for an action they cannot do.
 *
 * It has a command of its own, because Theia's `SPLIT_EDITOR_RIGHT` reads the
 * event's target and falls back to the focused group, so with two groups a
 * click on one group's button split the other's editor. The toolbar hands this
 * command the widget it belongs to, and that exact widget is split and
 * decides whether the button is enabled.
 */
@injectable()
export class SpexrSplitToolbarContribution implements TabBarToolbarContribution, CommandContribution {
  @inject(ContributionProvider) @named(SplitEditorContribution)
  private readonly splitters!: ContributionProvider<SplitEditorContribution>;

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(SPLIT_TOOLBAR_COMMAND, {
      isEnabled: (widget?: Widget) => !!widget && this.splitterFor(widget) !== undefined,
      isVisible: (widget?: Widget) => widget instanceof EditorWidget,
      execute: async (widget?: Widget) => {
        const splitter = widget && this.splitterFor(widget);
        if (widget && splitter) await splitter.split(widget, "split-right");
      },
    });
  }

  registerToolbarItems(registry: TabBarToolbarRegistry): void {
    registry.registerItem({
      id: SPLIT_TOOLBAR_ITEM_ID,
      command: SPLIT_TOOLBAR_COMMAND.id,
      icon: "codicon codicon-split-horizontal",
      tooltip: "Split Editor Right",
      group: "navigation",
      priority: 100,
      isVisible: (widget?: Widget) => widget instanceof EditorWidget,
    });
  }

  /** The contribution that can split this widget, by the priority it answers with. */
  private splitterFor(widget: Widget): SplitEditorContribution | undefined {
    return Prioritizeable.prioritizeAllSync(this.splitters.getContributions(), (c) => c.canHandle(widget))[0]?.value;
  }
}
