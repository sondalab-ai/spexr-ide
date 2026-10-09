import { injectable } from "@theia/core/shared/inversify";
import { MonacoEditorProvider } from "@theia/monaco/lib/browser/monaco-editor-provider";
import type { MonacoEditorModel } from "@theia/monaco/lib/browser/monaco-editor-model";
import type { MonacoEditor } from "@theia/monaco/lib/browser/monaco-editor";
import { SPEXR_GUTTER_OPTIONS } from "./spexr-editor-gutter.js";

/**
 * Theia's Monaco editor provider with the demo's gutter. The two options that
 * size it, `lineNumbersMinChars` and `lineDecorationsWidth`, are not Theia
 * preferences, and Theia sets the first from the model on every update of the
 * options, so they are laid over what it builds rather than set once on a
 * created editor.
 */
@injectable()
export class SpexrMonacoEditorProvider extends MonacoEditorProvider {
  protected override createMonacoEditorOptions(model: MonacoEditorModel): MonacoEditor.IOptions {
    return { ...super.createMonacoEditorOptions(model), ...SPEXR_GUTTER_OPTIONS };
  }
}
