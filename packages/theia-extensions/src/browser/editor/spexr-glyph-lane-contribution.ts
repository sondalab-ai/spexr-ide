import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { EditorManager } from "@theia/editor/lib/browser/editor-manager";
import { MonacoEditor } from "@theia/monaco/lib/browser/monaco-editor";
import { SpexrGlyphLane } from "./spexr-glyph-lane-service.js";
import { refreshGlyphLanes, type LaneEditor } from "./spexr-glyph-lane.js";

/** Shows and hides the glyph lane in the open editors as breakpoints and debug sessions come and go. */
@injectable()
export class SpexrGlyphLaneContribution implements FrontendApplicationContribution {
  @inject(SpexrGlyphLane) private readonly lane!: SpexrGlyphLane;
  @inject(EditorManager) private readonly editors!: EditorManager;
  private readonly held = new WeakMap<object, boolean>();

  onStart(): void {
    this.lane.onDidChange(() => this.refresh());
  }

  private refresh(): void {
    // The instanceof check skips diff editors on purpose: they are not MonacoEditor instances and keep the gutter their options give them.
    const open: LaneEditor[] = [];
    for (const widget of this.editors.all) {
      if (widget.editor instanceof MonacoEditor) open.push(widget.editor);
    }
    refreshGlyphLanes(open, this.lane, this.held);
  }
}
