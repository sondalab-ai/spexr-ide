import { injectable, inject } from "@theia/core/shared/inversify";
import {
  type FrontendApplicationContribution,
  ApplicationShell,
  type Widget,
} from "@theia/core/lib/browser";
import type {
  CommandContribution} from "@theia/core/lib/common/command";
import {
  type CommandRegistry,
  type Command,
} from "@theia/core/lib/common/command";
import { EditorManager, EditorWidget } from "@theia/editor/lib/browser";
import { SpexrSpecPreviewWidget } from "./spec-preview-widget.js";
import { decideSpecPreview } from "./spec-preview-policy.js";

const SPEC_FILE_RE = /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/;

export const SPEC_PREVIEW_TOGGLE_COMMAND: Command = {
  id: "spexr.view.spec-preview.toggle",
  label: "SPEXR: Toggle markdown preview",
};

/**
 * Wires the auto-open split-right behaviour for the spec markdown preview.
 *
 * Auto-open rules (AC-1, AC-5):
 * - When a new spec EditorWidget is added to the shell, open the preview
 *   split-right of it — unless the user closed it while viewing that same spec.
 * - Switching to a different spec URI after a manual close re-opens the preview.
 *
 * Also registers the `spexr.view.spec-preview.toggle` command used by the
 * toolbar item (AC-6).
 */
@injectable()
export class SpexrSpecPreviewContribution
  implements FrontendApplicationContribution, CommandContribution
{
  @inject(ApplicationShell)
  private readonly shell!: ApplicationShell;

  @inject(EditorManager)
  private readonly editorManager!: EditorManager;

  @inject(SpexrSpecPreviewWidget)
  private readonly preview!: SpexrSpecPreviewWidget;

  /** User's last explicit intent: open (true) or closed (false). */
  private wantOpen = true;
  /** URI for which the user last set wantOpen = false. */
  private closedForUri: string | undefined;
  /** True while we add/close the preview ourselves so those shell events are ignored. */
  private programmatic = false;

  onStart(): void {
    this.shell.onDidAddWidget((w) => {
      this.captureIntent(w, true);
      void this.handleWidgetAdded(w);
    });
    this.shell.onDidRemoveWidget((w) => {
      this.captureIntent(w, false);
      // Closing a spec that was not in front changes no current widget, so the
      // removal itself has to trigger the reconciliation.
      if (this.isSpecEditorWidget(w)) void this.enforce(w);
    });
    this.shell.onDidChangeCurrentWidget(() => void this.enforce());
  }

  registerCommands(registry: CommandRegistry): void {
    registry.registerCommand(SPEC_PREVIEW_TOGGLE_COMMAND, {
      execute: () => void this.togglePreview(),
    });
  }

  /** Called by the toolbar item to force-open or close the preview (AC-6). */
  async togglePreview(): Promise<void> {
    if (this.preview.isAttached) {
      await this.run(() => { this.preview.close(); });
      // captureIntent is suppressed while programmatic=true, so set wantOpen
      // manually — otherwise enforce() would immediately reopen the preview.
      this.wantOpen = false;
      this.closedForUri = this.editorManager.currentEditor?.getResourceUri()?.toString();
      return;
    }
    const current = this.editorManager.currentEditor;
    if (current && this.isSpecEditor(current)) {
      await this.openPreviewFor(current);
    }
  }

  private async handleWidgetAdded(widget: Widget): Promise<void> {
    if (this.programmatic) return;
    if (!this.isSpecEditorWidget(widget)) return;
    const uri = (widget as EditorWidget).getResourceUri()?.toString();
    if (!uri) return;
    const shouldOpen = this.wantOpen || uri !== this.closedForUri;
    if (shouldOpen && !this.preview.isAttached) {
      await this.openPreviewFor(widget as EditorWidget);
    }
  }

  private async openPreviewFor(editorWidget: EditorWidget): Promise<void> {
    if (this.preview.isAttached) return;
    await this.run(async () => {
      await this.shell.addWidget(this.preview, {
        area: "main",
        ref: editorWidget,
        mode: "split-right",
      });
      // Do NOT activateWidget here — it would steal focus from whatever the user
      // last clicked, causing race-condition tab switches on async open.
    });
    this.wantOpen = true;
    this.closedForUri = undefined;
  }

  private captureIntent(widget: Widget, opened: boolean): void {
    if (this.programmatic || widget.id !== SpexrSpecPreviewWidget.ID) return;
    this.wantOpen = opened;
    if (!opened) {
      this.closedForUri = this.editorManager.currentEditor
        ?.getResourceUri()
        ?.toString();
    }
  }

  private async run(op: () => Promise<void> | void): Promise<void> {
    this.programmatic = true;
    try {
      await op();
    } finally {
      this.programmatic = false;
    }
  }

  /**
   * Reconcile preview visibility against the main area (AC-4). The decision
   * lives in {@link decideSpecPreview}; this only reads the shell and applies it.
   *
   * @param removed Widget being torn down, excluded from the "any spec still
   *   open" count — during `onDidRemoveWidget` it is detached but not yet
   *   marked disposed, so it would otherwise keep the preview alive.
   */
  private async enforce(removed?: Widget): Promise<void> {
    if (this.programmatic) return;
    const current = this.shell.getCurrentWidget("main");
    const frontSpecUri = this.isSpecEditorWidget(current)
      ? (current as EditorWidget).getResourceUri()?.toString()
      : undefined;

    const action = decideSpecPreview({
      ...(frontSpecUri !== undefined ? { frontSpecUri } : {}),
      attached: this.preview.isAttached,
      anySpecOpen: this.anySpecOpen(removed),
      wantOpen: this.wantOpen,
      ...(this.closedForUri !== undefined ? { closedForUri: this.closedForUri } : {}),
    });

    if (action === "open") {
      await this.openPreviewFor(current as EditorWidget);
    } else if (action === "close") {
      await this.run(() => { this.preview.close(); });
    }
  }

  private anySpecOpen(excluded?: Widget): boolean {
    return this.editorManager.all.some(
      (w) => w !== excluded && !w.isDisposed && this.isSpecEditorWidget(w),
    );
  }

  private isSpecEditor(widget: EditorWidget): boolean {
    return SPEC_FILE_RE.test(widget.getResourceUri()?.path.base ?? "");
  }

  private isSpecEditorWidget(widget: Widget | undefined): boolean {
    if (!(widget instanceof EditorWidget)) return false;
    return this.isSpecEditor(widget);
  }
}
