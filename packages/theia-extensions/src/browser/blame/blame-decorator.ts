import { injectable, inject } from "@theia/core/shared/inversify";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import { DisposableCollection } from "@theia/core";
import { EditorManager, type EditorWidget } from "@theia/editor/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { MonacoEditor } from "@theia/monaco/lib/browser/monaco-editor";
import * as monaco from "@theia/monaco-editor-core";
import type URI from "@theia/core/lib/common/uri";
import { SpexrGitServiceProxySymbol } from "../scm/git-service-proxy.js";
import { SpexrGitScmRegistry } from "../scm/git-scm-registry.js";
import { locateInRepo } from "../scm/git-repo-roots.js";
import type { SpexrGitService, BlameResultDto, BlameCommitDto } from "../../common/git-protocol.js";

const ZERO_HASH = "0000000000000000000000000000000000000000";
const MAX_AUTHOR_WIDTH = 18;

/**
 * Renders inline `git blame` annotations on the whole active file: a left
 * margin column of `‹short-hash› ‹author› ‹relative date›` per line, plus a
 * hover with the full commit detail. Toggled on/off globally via
 * {@link SpexrGitBlameDecorator.toggle}.
 *
 * Annotations are cleared while the buffer is dirty — blame line numbers only
 * match committed content, so unsaved edits would mislabel lines — and
 * recomputed on save and on any git change (commit, checkout, fetch).
 */
@injectable()
export class SpexrGitBlameDecorator implements FrontendApplicationContribution {
  @inject(EditorManager)
  private readonly editorManager!: EditorManager;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(SpexrGitScmRegistry)
  private readonly registry!: SpexrGitScmRegistry;

  @inject(SpexrGitServiceProxySymbol)
  private readonly gitService!: SpexrGitService;

  private enabled = false;

  /**
   * Normalized https base of each repository's `origin` remote (for commit
   * links), keyed by repository root and resolved once per repository. One
   * shared value would put the first repository's host on every other
   * repository's commit links in a multi-root workspace.
   */
  private readonly remoteBases = new Map<string, string | undefined>();

  /** Live decoration collections, keyed by editor URI string. */
  private readonly collections = new Map<string, monaco.editor.IEditorDecorationsCollection>();
  /** Per-editor listener disposables, keyed by editor URI string. */
  private readonly editorListeners = new Map<string, DisposableCollection>();
  /** Cached blame per URI string, invalidated on save / git change. */
  private readonly cache = new Map<string, BlameResultDto>();

  onStart(): void {
    this.editorManager.onCreated((widget) => this.trackEditor(widget));
    this.editorManager.onActiveEditorChanged((widget) => {
      if (this.enabled && widget) void this.decorate(widget);
    });
    for (const widget of this.editorManager.all) this.trackEditor(widget);

    // Commit / checkout / fetch land as file changes: drop cache and redraw.
    this.fileService.onDidFilesChange(() => {
      if (!this.enabled) return;
      this.cache.clear();
      for (const widget of this.editorManager.all) void this.decorate(widget);
    });
  }

  /** Flip blame on/off for every editor. */
  toggle(): void {
    this.enabled = !this.enabled;
    if (this.enabled) {
      for (const widget of this.editorManager.all) void this.decorate(widget);
    } else {
      for (const key of this.collections.keys()) this.clearByKey(key);
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  private trackEditor(widget: EditorWidget): void {
    const key = widget.editor.uri.toString();
    if (this.editorListeners.has(key)) return;

    const listeners = new DisposableCollection();
    // Dirty edits desync blame line mapping → clear until saved.
    listeners.push(
      widget.editor.onDocumentContentChanged(() => {
        this.cache.delete(key);
        this.clearByKey(key);
      }),
    );
    listeners.push(
      widget.saveable.onDirtyChanged(() => {
        if (this.enabled && !widget.saveable.dirty) void this.decorate(widget);
      }),
    );
    widget.disposed.connect(() => this.disposeEditor(key));
    this.editorListeners.set(key, listeners);

    if (this.enabled) void this.decorate(widget);
  }

  private async decorate(widget: EditorWidget): Promise<void> {
    if (!this.enabled || widget.isDisposed || widget.saveable.dirty) return;
    const monacoEditor = MonacoEditor.get(widget);
    if (!monacoEditor) return;

    const uri = widget.editor.uri;
    const located = this.locate(uri);
    if (!located) return;
    const { root, relPath } = located;

    const remoteBase = await this.remoteBaseFor(root);

    const key = uri.toString();
    let blame = this.cache.get(key);
    if (!blame) {
      try {
        blame = await this.gitService.getBlame(root, relPath);
      } catch {
        return; // not a tracked file / not a repo
      }
      this.cache.set(key, blame);
    }
    // The buffer may have gone dirty or closed while awaiting.
    if (!this.enabled || widget.isDisposed || widget.saveable.dirty) return;

    this.render(monacoEditor, blame, remoteBase);
  }

  /** Fetch and cache one repository's origin remote URL, once per session. */
  private async remoteBaseFor(root: string): Promise<string | undefined> {
    // `has`, not a truthy check: a repository with no remote caches `undefined`
    // and must not be re-probed on every redraw.
    if (this.remoteBases.has(root)) return this.remoteBases.get(root);
    let base: string | undefined;
    try {
      base = await this.gitService.getRemoteUrl(root);
    } catch {
      base = undefined;
    }
    this.remoteBases.set(root, base);
    return base;
  }

  private render(
    monacoEditor: MonacoEditor,
    blame: BlameResultDto,
    remoteBase: string | undefined,
  ): void {
    const authorWidth = Math.min(
      MAX_AUTHOR_WIDTH,
      Math.max(...Object.values(blame.commits).map((c) => displayAuthor(c).length), 1),
    );

    // Three injected-text segments per line (hash · author · date), each with
    // its own colour. Monaco renders multiple `before` injections at the same
    // position in insertion order, so push hash → author → date.
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const l of blame.lines) {
      const commit = blame.commits[l.hash];
      const hover = commit ? hoverMarkdown(commit, remoteBase) : null;
      const seg = annotationSegments(commit, authorWidth);
      // Hover lives on a single segment only; attaching it to all three would
      // stack three identical tooltips at the same position.
      decorations.push(
        this.segment(l.line, seg.hash, "spexr-blame-hash", null),
        this.segment(l.line, seg.author, "spexr-blame-author", hover),
        this.segment(l.line, seg.date, "spexr-blame-date", null),
      );
    }

    const key = monacoEditor.getResourceUri().toString();
    let collection = this.collections.get(key);
    if (!collection) {
      collection = monacoEditor.getControl().createDecorationsCollection();
      this.collections.set(key, collection);
    }
    collection.set(decorations);
  }

  private segment(
    line: number,
    content: string,
    cssClass: string,
    hover: monaco.IMarkdownString | null,
  ): monaco.editor.IModelDeltaDecoration {
    return {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: false,
        showIfCollapsed: true,
        before: {
          content,
          inlineClassName: `spexr-blame ${cssClass}`,
          inlineClassNameAffectsLetterSpacing: true,
        },
        hoverMessage: hover,
      },
    };
  }

  private clearByKey(key: string): void {
    this.collections.get(key)?.clear();
  }

  private disposeEditor(key: string): void {
    this.editorListeners.get(key)?.dispose();
    this.editorListeners.delete(key);
    this.collections.delete(key);
    this.cache.delete(key);
  }

  /**
   * The repository a file belongs to, and its path within it. Resolved against
   * every repository in the workspace rather than the first one: blame is asked
   * for by absolute path, and in a multi-root workspace the first folder's
   * repository is simply the wrong one for a file in any other folder.
   */
  private locate(uri: URI): { root: string; relPath: string } | undefined {
    if (uri.scheme !== "file") return undefined;
    const roots = this.registry.all.map((p) => p.root).filter((r): r is string => r !== undefined);
    return locateInRepo(roots, uri.path.toString());
  }
}

/** Display name for a commit author, falling back for uncommitted lines. */
function displayAuthor(commit: BlameCommitDto | undefined): string {
  if (!commit || commit.hash === ZERO_HASH) return "Uncommitted";
  return commit.author || "Unknown";
}

/**
 * Left-margin annotation split into three padded segments so the columns align
 * in the monospace editor. Each carries a trailing space as a separator.
 */
function annotationSegments(
  commit: BlameCommitDto | undefined,
  authorWidth: number,
): { hash: string; author: string; date: string } {
  if (!commit || commit.hash === ZERO_HASH) {
    return {
      hash: `${"0".repeat(8)} `,
      author: `${"Uncommitted".padEnd(authorWidth)} `,
      date: "",
    };
  }
  return {
    hash: `${commit.hash.slice(0, 8)} `,
    author: `${truncate(displayAuthor(commit), authorWidth).padEnd(authorWidth)} `,
    date: `${relativeDate(commit.authorTime)} `,
  };
}

function hoverMarkdown(
  commit: BlameCommitDto,
  remoteBase: string | undefined,
): monaco.IMarkdownString {
  if (commit.hash === ZERO_HASH) {
    return { value: "Uncommitted change" };
  }
  const short = commit.hash.slice(0, 8);
  const when = new Date(commit.authorTime * 1000).toLocaleString();
  const lines = [
    `**${escapeMd(commit.summary)}**`,
    "",
    `${escapeMd(commit.author)} <${escapeMd(commit.authorMail)}>`,
    "",
    when,
    "",
  ];
  const url = commitUrl(remoteBase, commit.hash);
  lines.push(url ? `[\`${short}\` · View commit ↗](${url})` : `\`${short}\``);
  // Plain http(s) links stay clickable in untrusted markdown; isTrusted (which
  // would also enable command: URIs) is deliberately left off — remoteBase is
  // attacker-controllable when opening an untrusted repo.
  return { value: lines.join("\n") };
}

/**
 * Build a web URL for a commit on the known host, or undefined without one.
 * Rejects any remoteBase that isn't http(s) and percent-encodes the hash, so a
 * crafted `origin` URL cannot smuggle a non-web scheme into the hover link.
 */
function commitUrl(remoteBase: string | undefined, hash: string): string | undefined {
  if (!remoteBase) return undefined;
  try {
    const { protocol } = new URL(remoteBase);
    if (protocol !== "https:" && protocol !== "http:") return undefined;
  } catch {
    return undefined;
  }
  const h = encodeURIComponent(hash);
  if (/gitlab/.test(remoteBase)) return `${remoteBase}/-/commit/${h}`;
  if (/bitbucket/.test(remoteBase)) return `${remoteBase}/commits/${h}`;
  return `${remoteBase}/commit/${h}`; // github + sensible default
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function escapeMd(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!])/g, "\\$1");
}

/** Compact "x ago" string from a unix-seconds timestamp. */
function relativeDate(unixSeconds: number): string {
  const seconds = Math.max(0, Date.now() / 1000 - unixSeconds);
  const units: [string, number][] = [
    ["y", 365 * 24 * 3600],
    ["mo", 30 * 24 * 3600],
    ["d", 24 * 3600],
    ["h", 3600],
    ["m", 60],
  ];
  for (const [label, size] of units) {
    const n = Math.floor(seconds / size);
    if (n >= 1) return `${n}${label} ago`;
  }
  return "just now";
}
