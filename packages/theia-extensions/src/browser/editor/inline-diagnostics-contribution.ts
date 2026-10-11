import { inject, injectable } from "@theia/core/shared/inversify";
import { DisposableCollection } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { EditorManager, type EditorWidget } from "@theia/editor/lib/browser";
import { MonacoEditor } from "@theia/monaco/lib/browser/monaco-editor";
import { ProblemManager } from "@theia/markers/lib/browser/problem/problem-manager";
import * as monaco from "@theia/monaco-editor-core";
import { SPEXR_EDITOR_INLINE_DIAGNOSTICS_PREFERENCE } from "../preferences/spexr-preferences.js";
import { inlineClass, inlineDiagnostics, type InlineMarker } from "./inline-diagnostics.js";

/** How long after a change the chips are drawn again: markers arrive in bursts as the language server works. */
const REFRESH_MS = 200;

/**
 * Draws each warning and error of an open file as a chip after its line
 * (inline-diagnostics.ts), through Monaco's injected-text decorations: one per
 * line, as text only. Behind `spexr.editor.inlineDiagnostics`.
 *
 * Only editors that are showing are decorated, and only after a pause: the
 * markers of a file change in bursts, and an editor in a hidden tab costs
 * nothing until it is shown again (the editor manager's active-editor event
 * brings it back up to date).
 */
@injectable()
export class SpexrInlineDiagnosticsContribution implements FrontendApplicationContribution {
  @inject(ProblemManager) private readonly problems!: ProblemManager;
  @inject(EditorManager) private readonly editors!: EditorManager;
  @inject(PreferenceService) private readonly preferences!: PreferenceService;

  private readonly collections = new Map<MonacoEditor, monaco.editor.IEditorDecorationsCollection>();
  private readonly listeners = new Map<MonacoEditor, DisposableCollection>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  onStart(): void {
    this.problems.onDidChangeMarkers(() => this.schedule());
    this.preferences.onPreferenceChanged((e) => {
      if (e.preferenceName === SPEXR_EDITOR_INLINE_DIAGNOSTICS_PREFERENCE) this.schedule();
    });
    this.editors.onCreated((widget) => this.track(widget));
    this.editors.onCurrentEditorChanged(() => this.schedule());
    this.editors.onActiveEditorChanged(() => this.schedule());
    for (const widget of this.editors.all) this.track(widget);
  }

  onStop(): void {
    clearTimeout(this.timer);
  }

  private enabled(): boolean {
    return this.preferences.get<boolean>(SPEXR_EDITOR_INLINE_DIAGNOSTICS_PREFERENCE, true) !== false;
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh(), REFRESH_MS);
  }

  private track(widget: EditorWidget): void {
    const editor = widget.editor;
    if (!(editor instanceof MonacoEditor) || this.listeners.has(editor)) return;
    const control = editor.getControl();
    const listeners = new DisposableCollection();
    // The room a line has changes with the width and with edits; both are bursts.
    listeners.push(control.onDidLayoutChange(() => this.schedule()));
    listeners.push(control.onDidChangeModelContent(() => this.schedule()));
    listeners.push(widget.onDidDispose(() => this.forget(editor)));
    this.listeners.set(editor, listeners);
    this.schedule();
  }

  private forget(editor: MonacoEditor): void {
    this.listeners.get(editor)?.dispose();
    this.listeners.delete(editor);
    this.collections.get(editor)?.clear();
    this.collections.delete(editor);
  }

  private refresh(): void {
    const on = this.enabled();
    for (const widget of this.editors.all) {
      const editor = widget.editor;
      if (!(editor instanceof MonacoEditor)) continue;
      if (!on) this.collections.get(editor)?.clear();
      else if (widget.isVisible) this.decorate(editor);
    }
  }

  private decorate(editor: MonacoEditor): void {
    const control = editor.getControl();
    const model = control.getModel();
    if (!model) return;
    const markers: InlineMarker[] = this.problems.findMarkers({ uri: editor.getResourceUri() }).map((m) => ({
      line: m.data.range.start.line + 1,
      severity: m.data.severity,
      message: m.data.message,
    }));
    const charWidth = control.getOption(monaco.editor.EditorOption.fontInfo).typicalHalfwidthCharacterWidth || 8;
    const columns = Math.floor(control.getLayoutInfo().contentWidth / charWidth);
    const shown = inlineDiagnostics(markers, {
      columns,
      lineLength: (line) => (line <= model.getLineCount() ? model.getLineMaxColumn(line) - 1 : 0),
    });
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
          options: { showIfCollapsed: true, after: { content: d.text, inlineClassName: inlineClass(d.tone), inlineClassNameAffectsLetterSpacing: true } },
        };
      }),
    );
  }
}
