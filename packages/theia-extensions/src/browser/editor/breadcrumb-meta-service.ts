import { inject, injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core";
import { Saveable, type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { EditorManager } from "@theia/editor/lib/browser/editor-manager";
import type { EditorWidget } from "@theia/editor/lib/browser/editor-widget";
import { SpexrGitScmRegistry } from "../scm/git-scm-registry.js";
import { SpexrGitServiceProxySymbol } from "../scm/git-service-proxy.js";
import type { SpexrGitService } from "../../common/git-protocol.js";
import { breadcrumbMeta, type DiffStats } from "./breadcrumb-model.js";
import { diffStats } from "./diff-stats.js";

/** How long an edit settles before the diff is read again. */
const REFRESH_DELAY_MS = 500;

/**
 * What the breadcrumb row's right-hand meta reads (S6c, E7): per file URI, the
 * lines added and removed against HEAD and whether an editor on it holds
 * unsaved edits.
 *
 * The diff is Theia's own computation (diff-stats.ts) over HEAD's content
 * from spexr's git service. Theia's DirtyDiff service is not the source: it
 * asks the SCM provider for a revision URI in the provider's own scheme, which
 * spexr's provider does not resolve, so it never produces a diff here.
 * Starts with the application, so every editor is watched from its first.
 */
@injectable()
export class SpexrBreadcrumbMetaService implements FrontendApplicationContribution {
  @inject(EditorManager)
  private readonly editors!: EditorManager;

  @inject(SpexrGitScmRegistry)
  private readonly registry!: SpexrGitScmRegistry;

  @inject(SpexrGitServiceProxySymbol)
  private readonly git!: SpexrGitService;

  private readonly stats = new Map<string, DiffStats>();
  private readonly dirty = new Map<string, boolean>();
  private readonly changed = new Emitter<string>();

  /** Fires with the URI whose meta changed. */
  get onDidChange(): Event<string> {
    return this.changed.event;
  }

  /** The meta text for a file URI: "+a −d · not saved", or "" when there is nothing to say. */
  metaFor(uri: string | undefined): string {
    if (!uri) return "";
    return breadcrumbMeta(this.stats.get(uri), this.dirty.get(uri) ?? false);
  }

  onStart(): void {
    this.editors.all.forEach((widget) => this.watch(widget));
    this.editors.onCreated((widget) => this.watch(widget));
    this.registry.onDidChangeStatus(() => this.editors.all.forEach((widget) => void this.refresh(widget)));
  }

  /** Follows one editor: its dirty state, and its text against HEAD after each edit settles. */
  private watch(widget: EditorWidget): void {
    const uri = widget.editor.uri.toString();
    const saveable = Saveable.get(widget);
    if (saveable) {
      this.dirty.set(uri, saveable.dirty);
      saveable.onDirtyChanged(() => {
        this.dirty.set(uri, saveable.dirty);
        this.changed.fire(uri);
      });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    widget.editor.onDocumentContentChanged(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void this.refresh(widget), REFRESH_DELAY_MS);
    });
    widget.disposed.connect(() => {
      if (timer) clearTimeout(timer);
    });
    void this.refresh(widget);
  }

  /** Reads HEAD's copy of the file and folds its difference from the editor's text; a file outside every repository has none. */
  private async refresh(widget: EditorWidget): Promise<void> {
    if (widget.isDisposed) return;
    const uri = widget.editor.uri.toString();
    const path = widget.editor.uri.path.fsPath();
    const root = this.registry.all.map((p) => p.root).find((r): r is string => !!r && path.startsWith(`${r}/`));
    if (!root) return;
    let previous = "";
    try {
      previous = await this.git.getFileAtRevision(root, path.slice(root.length + 1), "HEAD");
    } catch {
      // Untracked or new: every line is an addition.
    }
    if (widget.isDisposed) return;
    this.stats.set(uri, diffStats(previous, widget.editor.document.getText()));
    this.changed.fire(uri);
  }
}
