import { inject, injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core";
import { Saveable } from "@theia/core/lib/browser";
import { EditorManager } from "@theia/editor/lib/browser/editor-manager";
import { ScmDecorationsService } from "@theia/scm/lib/browser/decorations/scm-decorations-service";
import { breadcrumbMeta, foldDiffStats, type DiffStats } from "./breadcrumb-model.js";

/**
 * What the breadcrumb row's right-hand meta reads (S6c, E7): per file URI, the
 * lines added and removed against the committed revision (Theia's DirtyDiff,
 * the gutter's own source) and whether an editor on it holds unsaved edits.
 * It only listens; the diff is computed by Theia for the gutter anyway.
 */
@injectable()
export class SpexrBreadcrumbMetaService {
  @inject(ScmDecorationsService)
  private readonly decorations!: ScmDecorationsService;

  @inject(EditorManager)
  private readonly editors!: EditorManager;

  private readonly stats = new Map<string, DiffStats>();
  private readonly dirty = new Map<string, boolean>();
  private readonly changed = new Emitter<string>();
  private started = false;

  /** Fires with the URI whose meta changed. */
  get onDidChange(): Event<string> {
    return this.changed.event;
  }

  /** The meta text for a file URI: "+a −d · not saved", or "" when there is nothing to say. */
  metaFor(uri: string | undefined): string {
    if (!uri) return "";
    this.start();
    return breadcrumbMeta(this.stats.get(uri), this.dirty.get(uri) ?? false);
  }

  /** Subscribes on first use, so a window with no breadcrumbs listens to nothing. */
  private start(): void {
    if (this.started) return;
    this.started = true;
    this.decorations.onDirtyDiffUpdate((update) => {
      const uri = update.editor.uri.toString();
      this.stats.set(uri, foldDiffStats(update.changes));
      this.changed.fire(uri);
    });
    const watch = (widget: { editor: { uri: { toString(): string } } }): void => {
      const uri = widget.editor.uri.toString();
      const saveable = Saveable.get(widget as never);
      if (!saveable) return;
      this.dirty.set(uri, saveable.dirty);
      saveable.onDirtyChanged(() => {
        this.dirty.set(uri, saveable.dirty);
        this.changed.fire(uri);
      });
    };
    this.editors.all.forEach(watch);
    this.editors.onCreated(watch);
  }
}
