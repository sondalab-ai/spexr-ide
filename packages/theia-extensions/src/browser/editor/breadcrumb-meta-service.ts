import { inject, injectable } from "@theia/core/shared/inversify";
import { DisposableCollection, Emitter, type Event } from "@theia/core";
import { Saveable, type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { EditorManager } from "@theia/editor/lib/browser/editor-manager";
import type { EditorWidget } from "@theia/editor/lib/browser/editor-widget";
import { SpexrGitScmRegistry } from "../scm/git-scm-registry.js";
import { SpexrGitServiceProxySymbol } from "../scm/git-service-proxy.js";
import type { SpexrGitService } from "../../common/git-protocol.js";
import { breadcrumbMeta } from "./breadcrumb-model.js";
import { BreadcrumbStats } from "./breadcrumb-stats.js";
import { headSignature, repoRootFor } from "./diff-budget.js";
import { diffStats } from "./diff-stats.js";

/** How long an edit settles before the diff is read again. */
const REFRESH_DELAY_MS = 500;

/** What is held for one file URI: its editors, and the subscriptions shared by all of them. */
interface Watcher {
  readonly widgets: Set<EditorWidget>;
  readonly toDispose: DisposableCollection;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * What the breadcrumb row's right-hand meta reads (S6c, E7): per file URI, the
 * lines added and removed against HEAD and whether an editor on it holds
 * unsaved edits.
 *
 * The diff is Theia's own computation (diff-stats.ts) over HEAD's text from
 * spexr's git service. Theia's DirtyDiff service is not the source: it asks
 * the SCM provider for a revision URI in the provider's own scheme, which
 * spexr's provider does not resolve, so it never produces a diff here.
 *
 * The costs are kept down (breadcrumb-stats.ts, diff-budget.ts): one watcher
 * per file however many editors show it, HEAD's text cached until the
 * repository's head signature changes, only an editor that is on screen is
 * diffed (one that comes back is read again), and a difference over the budget
 * shows no stat. Starts with the application, so every editor is watched from
 * its first.
 */
@injectable()
export class SpexrBreadcrumbMetaService implements FrontendApplicationContribution {
  @inject(EditorManager)
  private readonly editors!: EditorManager;

  @inject(SpexrGitScmRegistry)
  private readonly registry!: SpexrGitScmRegistry;

  @inject(SpexrGitServiceProxySymbol)
  private readonly git!: SpexrGitService;

  private readonly watchers = new Map<string, Watcher>();
  private readonly dirty = new Map<string, boolean>();
  private readonly changed = new Emitter<string>();
  private readonly toDispose = new DisposableCollection();
  private stats!: BreadcrumbStats;

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
    this.stats = new BreadcrumbStats({
      roots: () => this.registry.all.map((p) => p.root).filter((r): r is string => !!r),
      signature: (root, rel) => headSignature(this.registry.all.find((p) => p.root === root)?.lastStatus, rel),
      readHead: (root, rel) => this.git.getFileAtRevision(root, rel, "HEAD"),
      diff: diffStats,
    });
    this.editors.all.forEach((widget) => this.watch(widget));
    this.toDispose.push(this.editors.onCreated((widget) => this.watch(widget)));
    this.toDispose.push(this.registry.onDidChangeStatus(() => this.editors.all.forEach((widget) => void this.refresh(widget))));
  }

  onStop(): void {
    for (const [uri] of this.watchers) this.release(uri);
    this.toDispose.dispose();
  }

  /** Follows an editor: its file's watcher is made once, and shared by every editor on that file. */
  private watch(widget: EditorWidget): void {
    const uri = widget.editor.uri.toString();
    let watcher = this.watchers.get(uri);
    if (!watcher) {
      watcher = { widgets: new Set(), toDispose: new DisposableCollection() };
      this.watchers.set(uri, watcher);
      const shared = watcher;
      shared.toDispose.push(
        widget.editor.onDocumentContentChanged(() => {
          if (shared.timer) clearTimeout(shared.timer);
          shared.timer = setTimeout(() => this.refreshUri(uri), REFRESH_DELAY_MS);
        }),
      );
    }
    watcher.widgets.add(widget);
    const saveable = Saveable.get(widget);
    if (saveable) {
      watcher.toDispose.push(
        saveable.onDirtyChanged(() => {
          this.dirty.set(uri, this.anyDirty(uri));
          this.changed.fire(uri);
        }),
      );
    }
    this.dirty.set(uri, this.anyDirty(uri));
    watcher.toDispose.push(widget.onDidChangeVisibility((visible) => visible && void this.refresh(widget)));
    widget.disposed.connect(() => {
      const w = this.watchers.get(uri);
      if (!w) return;
      w.widgets.delete(widget);
      if (w.widgets.size === 0) this.release(uri);
    });
    void this.refresh(widget);
  }

  /** Whether any editor on the file holds unsaved edits. */
  private anyDirty(uri: string): boolean {
    return [...(this.watchers.get(uri)?.widgets ?? [])].some((w) => Saveable.get(w)?.dirty);
  }

  /** The last editor on a file is gone: its subscriptions, timer and every map entry go with it. */
  private release(uri: string): void {
    const watcher = this.watchers.get(uri);
    if (!watcher) return;
    if (watcher.timer) clearTimeout(watcher.timer);
    watcher.toDispose.dispose();
    this.watchers.delete(uri);
    this.dirty.delete(uri);
    this.stats.forget(uri);
  }

  private refreshUri(uri: string): void {
    const widget = [...(this.watchers.get(uri)?.widgets ?? [])].find((w) => w.isVisible) ?? [...(this.watchers.get(uri)?.widgets ?? [])][0];
    if (widget) void this.refresh(widget);
  }

  /** Reads the editor's text against HEAD, if the editor is on screen (a hidden one is read when it comes back). */
  private async refresh(widget: EditorWidget): Promise<void> {
    if (widget.isDisposed || !widget.isVisible) return;
    const uri = widget.editor.uri.toString();
    const path = widget.editor.uri.path.fsPath();
    if (!repoRootFor(path, this.registry.all.map((p) => p.root).filter((r): r is string => !!r))) return;
    if (await this.stats.refresh(uri, path, widget.editor.document.getText())) this.changed.fire(uri);
  }
}
