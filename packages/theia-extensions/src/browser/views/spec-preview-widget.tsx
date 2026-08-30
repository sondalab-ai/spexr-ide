import * as React from "react";
import { flushSync } from "react-dom";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, Widget, type Message } from "@theia/core/lib/browser";
import { DisposableCollection } from "@theia/core/lib/common/disposable";
import { EditorManager, type EditorWidget } from "@theia/editor/lib/browser";
import { marked } from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import xml from "highlight.js/lib/languages/xml";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import java from "highlight.js/lib/languages/java";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import go from "highlight.js/lib/languages/go";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("java", java);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("go", go);

import { isMarkdownUri } from "./markdown-uri.js";

export const SPEC_PREVIEW_VIEW_ID = "spexr.view.spec-preview";
const DEBOUNCE_MS = 200;

interface PreviewState {
  readonly title: string;
  readonly html: string;
}

/**
 * Singleton ReactWidget that renders the active markdown editor's content as
 * HTML, updating live on every keystroke (debounced).
 *
 * Syntax highlighting: `onUpdateRequest` wraps the parent React render in
 * `flushSync` so the DOM is guaranteed to be committed before we call
 * `hljs.highlightElement()` on each code block.
 */
@injectable()
export class SpexrSpecPreviewWidget extends ReactWidget {
  static readonly ID = SPEC_PREVIEW_VIEW_ID;

  @inject(EditorManager)
  private readonly editorManager!: EditorManager;

  private state: PreviewState | undefined;
  private tracked: EditorWidget | undefined;
  private readonly trackedDisposables = new DisposableCollection();
  private debounce: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    super();
    this.id = SpexrSpecPreviewWidget.ID;
    this.title.label = "Spec preview";
    this.title.caption = "Live markdown preview of the open spec";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-open-preview";
    this.addClass("spexr-spec-preview-widget");
    this.node.tabIndex = 0;
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(this.trackedDisposables);
    this.toDispose.push(
      this.editorManager.onCurrentEditorChanged(() => this.retarget()),
    );
    this.retarget();
    this.update();
  }

  protected override onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    this.node.focus();
  }

  protected override onCloseRequest(_msg: Message): void {
    // Bypass Theia's default (which calls dispose()) so this singleton can be
    // reattached to the shell after being closed (e.g. via toolbar toggle).
    if (this.parent) {
      this.parent = null;
    } else if (this.isAttached) {
      Widget.detach(this);
    }
  }

  /**
   * Force a synchronous React commit via flushSync so hljs can query live DOM
   * nodes immediately after — React 18's createRoot.render() is async otherwise.
   */
  protected override onUpdateRequest(msg: Message): void {
    flushSync(() => super.onUpdateRequest(msg));
    this.node
      .querySelectorAll(".spexr-spec-preview__body pre code:not(.hljs)")
      .forEach((el) => hljs.highlightElement(el as HTMLElement));
  }

  /**
   * Bind to the active editor when it holds markdown. Other editors do not
   * clear the preview — the last markdown file stays until explicitly
   * closed (AC-4).
   */
  private retarget(): void {
    const widget = this.editorManager.currentEditor;
    const uri = widget?.getResourceUri();
    if (!widget || !isMarkdownUri(uri)) return; // keep last markdown visible (AC-4)
    if (this.tracked === widget) return;
    this.trackedDisposables.dispose();
    this.tracked = widget;
    this.title.label = `Preview: ${uri.path.base}`;
    this.trackedDisposables.push(
      widget.editor.onDocumentContentChanged(() => this.scheduleRender()),
    );
    this.scheduleRender();
  }

  private scheduleRender(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = undefined;
      this.render_();
    }, DEBOUNCE_MS);
  }

  private render_(): void {
    const widget = this.tracked;
    const uri = widget?.getResourceUri();
    if (!widget || !uri) return;
    const raw = widget.editor.document.getText();
    const content = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
    const html = DOMPurify.sanitize(marked.parse(content) as string, {
      FORBID_TAGS: ["script", "iframe"],
    });
    this.state = { title: uri.path.base, html };
    this.update();
  }

  protected render(): React.ReactNode {
    if (!this.state) {
      return (
        <div className="spexr-spec-preview" aria-label="Markdown preview">
          <p className="spexr-spec-preview__empty">Open a markdown file to preview it.</p>
        </div>
      );
    }
    return (
      <div className="spexr-spec-preview" aria-label={`Preview: ${this.state.title}`}>
        <div
          className="spexr-spec-preview__body"
          dangerouslySetInnerHTML={{ __html: this.state.html }}
        />
      </div>
    );
  }
}
