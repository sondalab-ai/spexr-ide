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
import { HeadShaCache } from "./head-sha-cache.js";
import { UriWatchers } from "./uri-watchers.js";

/** How long an edit settles before the diff is read again. */
const REFRESH_DELAY_MS = 500;

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

  private readonly watchers = new UriWatchers<EditorWidget>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly dirty = new Map<string, boolean>();
  private readonly changed = new Emitter<string>();
  private readonly toDispose = new DisposableCollection();
  private readonly shas = new HeadShaCache(async (root) => {
    try {
      return (await this.git.getLog(root, 1))[0]?.hash ?? "";
    } catch {
      // No commit yet, or git failed: the signature then rests on the status alone.
      return "";
    }
  });
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
      signature: async (root, rel) => headSignature(this.registry.all.find((p) => p.root === root)?.lastStatus, rel, await this.shas.get(root)),
      readHead: (root, rel) => this.git.getFileAtRevision(root, rel, "HEAD"),
      diff: diffStats,
    });
    this.editors.all.forEach((widget) => this.watch(widget));
    this.toDispose.push(this.editors.onCreated((widget) => this.watch(widget)));
    this.toDispose.push(
      this.registry.onDidChangeStatus(() => {
        // Any status event may follow a commit, a reset or a rebase: HEAD's sha is read afresh.
        this.shas.clear();
        this.watchers.uris().forEach((uri) => this.refreshUri(uri));
      }),
    );
  }

  onStop(): void {
    for (const uri of this.watchers.uris()) for (const widget of this.watchers.widgets(uri)) this.unwatch(uri, widget);
    this.toDispose.dispose();
  }

  /** Follows an editor: its own subscriptions (so closing it leaves the others' alone), and the file's shared state. */
  private watch(widget: EditorWidget): void {
    const uri = widget.editor.uri.toString();
    this.watchers.add(uri, widget, () => {
      const subs = [
        widget.editor.onDocumentContentChanged(() => {
          const pending = this.timers.get(uri);
          if (pending) clearTimeout(pending);
          this.timers.set(uri, setTimeout(() => this.refreshUri(uri), REFRESH_DELAY_MS));
        }),
        widget.onDidChangeVisibility((visible) => visible && void this.refresh(widget)),
      ];
      const saveable = Saveable.get(widget);
      if (saveable) {
        subs.push(
          saveable.onDirtyChanged(() => {
            this.dirty.set(uri, this.anyDirty(uri));
            this.changed.fire(uri);
          }),
        );
      }
      return subs;
    });
    this.dirty.set(uri, this.anyDirty(uri));
    widget.disposed.connect(() => this.unwatch(uri, widget));
    void this.refresh(widget);
  }

  /** An editor is gone: its subscriptions with it; the last one on a file takes the timer and every map entry too. */
  private unwatch(uri: string, widget: EditorWidget): void {
    if (!this.watchers.remove(uri, widget)) {
      this.dirty.set(uri, this.anyDirty(uri));
      return;
    }
    const pending = this.timers.get(uri);
    if (pending) clearTimeout(pending);
    this.timers.delete(uri);
    this.dirty.delete(uri);
    this.stats.forget(uri);
  }

  /** Whether any editor on the file holds unsaved edits. */
  private anyDirty(uri: string): boolean {
    return this.watchers.widgets(uri).some((w) => Saveable.get(w)?.dirty);
  }

  private refreshUri(uri: string): void {
    const widgets = this.watchers.widgets(uri);
    const widget = widgets.find((w) => w.isVisible) ?? widgets[0];
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
