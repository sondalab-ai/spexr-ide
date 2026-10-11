import { inject, injectable } from "@theia/core/shared/inversify";
import { DisposableCollection } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { EditorManager, type EditorWidget } from "@theia/editor/lib/browser";
import { MonacoEditor } from "@theia/monaco/lib/browser/monaco-editor";
import { ProblemManager } from "@theia/markers/lib/browser/problem/problem-manager";
import * as monaco from "@theia/monaco-editor-core";
import { SPEXR_EDITOR_INLINE_DIAGNOSTICS_PREFERENCE } from "../preferences/spexr-preferences.js";
import { displayWidth, inlineClass, plainTextBlock, type InlineDiagnostic, type InlineLayout } from "./inline-diagnostics.js";
import { InlineDiagnosticsRefresher, type InlineEditorPort } from "./inline-diagnostics-refresher.js";

/**
 * Draws each warning and error of an open file as a chip after its line
 * (inline-diagnostics.ts), through Monaco's injected-text decorations: one per
 * line, as text only, with the full message in a plain-text hover. Behind
 * `spexr.editor.inlineDiagnostics`. When and for which editors is the
 * refresher's (inline-diagnostics-refresher.ts); this is Monaco's side.
 *
 * The room a line has is measured in columns: the wrapping column (or the
 * content width over a character), less the line's own columns with tabs
 * expanded and wide characters counted twice. A pixel measure of the rendered
 * line would be exact, but a line that is not rendered has none, and
 * decorating only what is rendered would flicker on scroll; the estimate is
 * conservative (the chip's sans is narrower than the mono it is counted in).
 */
@injectable()
export class SpexrInlineDiagnosticsContribution implements FrontendApplicationContribution {
  @inject(ProblemManager) private readonly problems!: ProblemManager;
  @inject(EditorManager) private readonly editors!: EditorManager;
  @inject(PreferenceService) private readonly preferences!: PreferenceService;

  private readonly collections = new Map<MonacoEditor, monaco.editor.IEditorDecorationsCollection>();
  private readonly listeners = new Map<MonacoEditor, DisposableCollection>();
  private refresher!: InlineDiagnosticsRefresher;

  onStart(): void {
    this.refresher = new InlineDiagnosticsRefresher({
      editors: () => this.ports(),
      enabled: () => this.preferences.get<boolean>(SPEXR_EDITOR_INLINE_DIAGNOSTICS_PREFERENCE, true) !== false,
      warn: (message, error) => console.warn(`[spexr] ${message}`, error),
    });
    this.problems.onDidChangeMarkers((uri) => this.refresher.markersChanged(uri.toString()));
    this.preferences.onPreferenceChanged((e) => {
      if (e.preferenceName === SPEXR_EDITOR_INLINE_DIAGNOSTICS_PREFERENCE) this.refresher.schedule();
    });
    this.editors.onCreated((widget) => this.track(widget));
    this.editors.onCurrentEditorChanged(() => this.refresher.schedule());
    this.editors.onActiveEditorChanged(() => this.refresher.schedule());
    for (const widget of this.editors.all) this.track(widget);
  }

  onStop(): void {
    this.refresher?.dispose();
  }

  /** Monaco editors only, as the refresher's ports. */
  private ports(): InlineEditorPort[] {
    const out: InlineEditorPort[] = [];
    for (const widget of this.editors.all) {
      if (!(widget.editor instanceof MonacoEditor)) continue;
      const editor: MonacoEditor = widget.editor;
      const resource = editor.getResourceUri();
      out.push({
        key: widget.id,
        uri: resource.toString(),
        visible: widget.isVisible,
        markers: () =>
          this.problems.findMarkers({ uri: resource }).map((m) => ({ line: m.data.range.start.line + 1, severity: m.data.severity, message: m.data.message })),
        layout: () => this.layout(editor),
        apply: (shown) => this.apply(editor, shown),
        clear: () => this.collections.get(editor)?.clear(),
      });
    }
    return out;
  }

  private layout(editor: MonacoEditor): InlineLayout {
    const control = editor.getControl();
    const model = control.getModel();
    const info = control.getLayoutInfo();
    const charWidth = control.getOption(monaco.editor.EditorOption.fontInfo).typicalHalfwidthCharacterWidth || 8;
    const wrapAt = control.getOption(monaco.editor.EditorOption.wrappingInfo).wrappingColumn;
    const columns = wrapAt > 0 ? wrapAt : Math.floor(info.contentWidth / charWidth);
    const tabSize = model?.getOptions().tabSize ?? 4;
    return {
      columns,
      lineCount: model?.getLineCount() ?? 0,
      lineLength: (line) => (model && line <= model.getLineCount() ? displayWidth(model.getLineContent(line), tabSize, columns) : 0),
    };
  }

  private apply(editor: MonacoEditor, shown: readonly InlineDiagnostic[]): void {
    const control = editor.getControl();
    const model = control.getModel();
    if (!model) return;
    let collection = this.collections.get(editor);
    if (!collection) {
      collection = control.createDecorationsCollection();
      this.collections.set(editor, collection);
    }
    collection.set(
      shown.map((d) => {
        const end = model.getLineMaxColumn(d.line);
        return {
          range: new monaco.Range(d.line, end, d.line, end),
          options: {
            showIfCollapsed: true,
            after: { content: d.text, inlineClassName: inlineClass(d.tone), inlineClassNameAffectsLetterSpacing: true, cursorStops: monaco.editor.InjectedTextCursorStops.None },
            // The whole message, as plain text: nothing in it is Markdown or a command.
            hoverMessage: { value: plainTextBlock(d.full), isTrusted: false },
          },
        };
      }),
    );
  }

  private track(widget: EditorWidget): void {
    const editor = widget.editor;
    if (!(editor instanceof MonacoEditor) || this.listeners.has(editor)) return;
    const control = editor.getControl();
    const listeners = new DisposableCollection();
    // The room a line has changes with the width and with edits; both are bursts.
    listeners.push(control.onDidLayoutChange(() => this.refresher.schedule()));
    listeners.push(control.onDidChangeModelContent(() => this.refresher.schedule()));
    listeners.push(widget.onDidChangeVisibility(() => this.refresher.schedule()));
    listeners.push(widget.onDidDispose(() => this.forget(editor)));
    this.listeners.set(editor, listeners);
    this.refresher.schedule();
  }

  private forget(editor: MonacoEditor): void {
    this.listeners.get(editor)?.dispose();
    this.listeners.delete(editor);
    this.collections.get(editor)?.clear();
    this.collections.delete(editor);
  }
}
