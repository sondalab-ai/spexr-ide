import { injectable, inject } from "@theia/core/shared/inversify";
import type { Widget } from "@theia/core/shared/@lumino/widgets";
import type {
  TabBarToolbarContribution,
  TabBarToolbarRegistry,
} from "@theia/core/lib/browser/shell/tab-bar-toolbar";
import { EditorWidget } from "@theia/editor/lib/browser";
import { SpexrCommands, SpexrCommandsContribution } from "../commands/spexr-commands-contribution.js";
import { SPEC_PREVIEW_TOGGLE_COMMAND } from "./spec-preview-contribution.js";
import { isMarkdownUri } from "./markdown-uri.js";

/**
 * Surfaces two editor tab toolbar actions, with different scopes: "Send to
 * agent" only for a spec file under `<workspace>/docs/specs/`, and "Toggle
 * markdown preview" for any markdown file.
 */
@injectable()
export class SpexrSpecEditorToolbarContribution implements TabBarToolbarContribution {
  @inject(SpexrCommandsContribution)
  private readonly spexrCommands!: SpexrCommandsContribution;

  registerToolbarItems(registry: TabBarToolbarRegistry): void {
    registry.registerItem({
      id: "spexr.spec.editor.handoff",
      command: SpexrCommands.SPEC_HANDOFF.id,
      icon: "codicon codicon-rocket",
      tooltip: "Send spec to agent",
      priority: 0,
      isVisible: (widget?: Widget) => this.isSpecEditor(widget),
    });
    registry.registerItem({
      id: "spexr.spec.editor.preview",
      command: SPEC_PREVIEW_TOGGLE_COMMAND.id,
      icon: "codicon codicon-open-preview",
      tooltip: "Toggle markdown preview",
      priority: 1,
      isVisible: (widget?: Widget) => this.isMarkdownEditor(widget),
    });
  }

  private isSpecEditor(widget?: Widget): boolean {
    if (!(widget instanceof EditorWidget)) return false;
    return this.spexrCommands.isSpecUri(widget.getResourceUri());
  }

  private isMarkdownEditor(widget?: Widget): boolean {
    if (!(widget instanceof EditorWidget)) return false;
    return isMarkdownUri(widget.getResourceUri());
  }
}
