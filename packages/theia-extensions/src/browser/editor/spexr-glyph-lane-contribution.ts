import { inject, injectable } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { EditorManager } from "@theia/editor/lib/browser/editor-manager";
import { MonacoEditor } from "@theia/monaco/lib/browser/monaco-editor";
import { SpexrGlyphLane } from "./spexr-glyph-lane-service.js";

/** Shows and hides the glyph lane in the open editors as breakpoints and debug sessions come and go. */
@injectable()
export class SpexrGlyphLaneContribution implements FrontendApplicationContribution {
  @inject(SpexrGlyphLane) private readonly lane!: SpexrGlyphLane;
  @inject(EditorManager) private readonly editors!: EditorManager;

  onStart(): void {
    this.lane.onDidChange(() => this.refresh());
  }

  private refresh(): void {
    for (const widget of this.editors.all) {
      const editor = widget.editor;
      if (!(editor instanceof MonacoEditor)) continue;
      const option = this.lane.optionFor(editor.uri.toString());
      if (option) editor.getControl().updateOptions(option);
    }
  }
}
