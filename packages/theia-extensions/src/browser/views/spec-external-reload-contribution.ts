import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { MessageService } from "@theia/core";
import { EditorManager, type EditorWidget } from "@theia/editor/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type FileChangesEvent } from "@theia/filesystem/lib/common/files";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import type URI from "@theia/core/lib/common/uri";
import { locateSpec } from "../spec/spec-roots.js";


/**
 * Debounce window before deciding a dirty spec editor conflicts with disk.
 *
 * The watcher also fires for the user's own save; saving flips the editor to
 * clean slightly after the disk write lands. Waiting briefly lets that case
 * settle (editor becomes clean → no prompt), so only genuine external rewrites
 * — e.g. the agent editing the spec while the user has unsaved edits — prompt.
 */
const CONFLICT_DEBOUNCE_MS = 200;

/**
 * Offers to reload a spec editor when its file is changed on disk while the
 * editor holds unsaved edits.
 *
 * Theia auto-reloads externally modified files only when the buffer is clean
 * ({@link https://github.com/eclipse-theia/theia} `MonacoEditorModel.doSync`
 * bails on dirty buffers to avoid clobbering edits). When the SPEXR agent
 * rewrites a spec the user is editing, the editor would otherwise stay stale
 * until manually closed and reopened. This surfaces an explicit
 * reload/keep choice instead.
 */
@injectable()
export class SpexrSpecExternalReloadContribution implements FrontendApplicationContribution {
  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(EditorManager)
  private readonly editorManager!: EditorManager;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  /** URIs with a pending prompt, to avoid stacking dialogs on rapid edits. */
  private readonly prompting = new Set<string>();
  /** Per-URI debounce timers keyed by editor URI string. */
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  onStart(): void {
    this.fileService.onDidFilesChange((event) => this.handleChange(event));
  }

  private handleChange(event: FileChangesEvent): void {
    for (const widget of this.editorManager.all) {
      const uri = widget.editor.uri;
      if (!widget.saveable.dirty) continue; // clean editors auto-reload already
      if (!this.isSpec(uri)) continue;
      if (!event.contains(uri)) continue;
      this.scheduleConflictCheck(widget);
    }
  }

  private scheduleConflictCheck(widget: EditorWidget): void {
    const key = widget.editor.uri.toString();
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        if (widget.isDisposed || !widget.saveable.dirty) return; // saved meanwhile
        void this.promptReload(widget);
      }, CONFLICT_DEBOUNCE_MS),
    );
  }

  private async promptReload(widget: EditorWidget): Promise<void> {
    const key = widget.editor.uri.toString();
    if (this.prompting.has(key)) return;
    this.prompting.add(key);
    try {
      const name = widget.editor.uri.path.base;
      const reload = "Reload from disk";
      const keep = "Keep my changes";
      const choice = await this.messages.warn(
        `"${name}" was changed on disk (e.g. by the agent) while you have unsaved edits.`,
        reload,
        keep,
      );
      if (choice === reload && !widget.isDisposed) {
        await widget.saveable.revert?.();
      }
    } finally {
      this.prompting.delete(key);
    }
  }

  private isSpec(uri: URI): boolean {
    const roots = this.workspace.tryGetRoots().map((root) => root.resource);
    return locateSpec(roots, uri) !== undefined;
  }
}
