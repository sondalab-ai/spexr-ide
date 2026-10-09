import { inject, injectable } from "@theia/core/shared/inversify";
import { MonacoEditorProvider } from "@theia/monaco/lib/browser/monaco-editor-provider";
import type { MonacoEditorModel } from "@theia/monaco/lib/browser/monaco-editor-model";
import type { MonacoEditor } from "@theia/monaco/lib/browser/monaco-editor";
import type { MonacoDiffEditor } from "@theia/monaco/lib/browser/monaco-diff-editor";
import { withSpexrGutter } from "./spexr-editor-gutter.js";
import { SpexrGlyphLane } from "./spexr-glyph-lane-service.js";

/**
 * Theia's Monaco editor provider with the demo's gutter. The two options that
 * size it, `lineNumbersMinChars` and `lineDecorationsWidth`, are not Theia
 * preferences, and Theia sets the first from the model on every update of the
 * options, so they are laid over what it builds rather than set once on a
 * created editor. A diff editor's options are built apart, so its gutter is
 * set the same way.
 */
@injectable()
export class SpexrMonacoEditorProvider extends MonacoEditorProvider {
  @inject(SpexrGlyphLane) private readonly glyphLane!: SpexrGlyphLane;

  /** The gutter, and the glyph lane where debugging needs it (spexr-glyph-lane.ts); Theia's own options are rebuilt through here on every update without an event. */
  protected override createMonacoEditorOptions(model: MonacoEditorModel): MonacoEditor.IOptions {
    return { ...withSpexrGutter(super.createMonacoEditorOptions(model)), ...this.glyphLane.optionFor(model.uri) };
  }

  protected override createMonacoDiffEditorOptions(original: MonacoEditorModel, modified: MonacoEditorModel): MonacoDiffEditor.IOptions {
    return withSpexrGutter(super.createMonacoDiffEditorOptions(original, modified));
  }
}
