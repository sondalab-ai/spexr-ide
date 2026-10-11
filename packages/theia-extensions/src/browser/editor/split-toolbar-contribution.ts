import { injectable } from "@theia/core/shared/inversify";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import type {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { EditorCommands } from "@theia/editor/lib/browser/editor-command";
import { EditorWidget } from "@theia/editor/lib/browser/editor-widget";

/** The toolbar item's id: the main tab bar's split button (S6c, E5). */
export const SPLIT_TOOLBAR_ITEM_ID = "spexr.editor.split.toolbar";

/**
 * A split button at the right end of the editor strip, as Lumen's "Split":
 * it opens the current editor again to the right. Shown only while an editor
 * is the tab bar's current tab, so Welcome, Specs and the agents' wall carry
 * no button for an action they cannot do.
 */
@injectable()
export class SpexrSplitToolbarContribution implements TabBarToolbarContribution {
  registerToolbarItems(registry: TabBarToolbarRegistry): void {
    registry.registerItem({
      id: SPLIT_TOOLBAR_ITEM_ID,
      command: EditorCommands.SPLIT_EDITOR_RIGHT.id,
      icon: "codicon codicon-split-horizontal",
      tooltip: "Split Editor Right",
      group: "navigation",
      priority: 100,
      isVisible: (widget?: Widget) => widget instanceof EditorWidget,
    });
  }
}
