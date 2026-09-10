import * as React from "react";
import { injectable, inject, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget, type Message } from "@theia/core/lib/browser";
import { CommandService } from "@theia/core/lib/common/command";
import { EditorManager } from "@theia/editor/lib/browser";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { type FileOperationEvent } from "@theia/filesystem/lib/common/files";
import URI from "@theia/core/lib/common/uri";
import { parseSpec, parseFrontmatter } from "@spexr/spec";
import { SPEC_RESOURCES_VIEW_ID } from "./spec-resources-view-contribution.js";
import { SpexrCommands } from "../commands/spexr-commands-contribution.js";
import { SPEC_CONTEXT_DIR } from "../workspace-paths.js";
import { locateSpec, SPEC_SLUG_RE } from "../spec/spec-roots.js";

const LINK_LINE_RE = /^-\s*\[([^\]]+)\]\(([^)]+)\)/;
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

interface SpecResource {
  readonly kind: "file" | "link";
  readonly label: string;
  /** External target for links; undefined for copied files. */
  readonly href?: string;
  /** Human-readable, workspace-relative location where the resource is stored. */
  readonly storedAt: string;
}

interface ResourcesState {
  readonly slug: string;
  readonly specUri: string;
  readonly title: string;
  readonly resources: readonly SpecResource[];
}

/** Return the URL only if it uses a safe scheme, else undefined — blocks `javascript:` hrefs. */
function safeHref(raw: string): string | undefined {
  try {
    return SAFE_LINK_SCHEMES.has(new URL(raw).protocol) ? raw : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Bottom-panel view listing every resource attached to the spec the user just
 * opened — files copied into the context folder plus links recorded in
 * `_links.md` — as a human-readable list with each item's on-disk location.
 */
@injectable()
export class SpexrSpecResourcesWidget extends ReactWidget {
  static readonly ID = SPEC_RESOURCES_VIEW_ID;

  @inject(CommandService)
  private readonly commands!: CommandService;

  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(EditorManager)
  private readonly editorManager!: EditorManager;

  private state: ResourcesState | undefined;

  constructor() {
    super();
    this.id = SpexrSpecResourcesWidget.ID;
    this.title.label = "Linked resources";
    this.title.caption = "Resources linked to the open spec";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-link";
    this.addClass("spexr-spec-resources-widget");
  }

  @postConstruct()
  protected init(): void {
    this.toDispose.push(
      this.fileService.onDidRunOperation((event) => {
        if (this.affectsCurrent(event)) void this.reload();
      }),
    );
    this.toDispose.push(
      this.editorManager.onCurrentEditorChanged(() => void this.syncToActiveSpec()),
    );
    void this.syncToActiveSpec();
    this.update();
  }

  /**
   * Bind the panel to the active editor when it is a spec, so the resources
   * reflect whatever spec the user is looking at — even when it became active
   * without going through the Open command (layout restore, tab switch, …).
   * Non-spec editors leave the current state untouched.
   */
  private async syncToActiveSpec(): Promise<void> {
    const uri = this.editorManager.currentEditor?.getResourceUri();
    const slug = uri ? this.slugFromUri(uri.toString()) : undefined;
    if (uri && slug) {
      if (this.state?.specUri !== uri.toString()) {
        await this.showFor(uri.toString(), await this.specTitle(uri));
      }
      return;
    }
    // Active editor is not a spec. Clear the panel only when the shown spec is
    // no longer open anywhere — otherwise the user merely shifted focus.
    if (this.state && !this.isSpecOpen(this.state.specUri)) {
      this.state = undefined;
      this.update();
    }
  }

  private isSpecOpen(specUri: string): boolean {
    return this.editorManager.all.some((w) => w.getResourceUri()?.toString() === specUri);
  }

  private async specTitle(uri: URI): Promise<string> {
    try {
      const file = await this.fileService.read(uri);
      const spec = parseSpec(file.value, uri.toString());
      if (spec.frontmatter.title) return spec.frontmatter.title;
    } catch {
      // Fall back to the filename below.
    }
    return uri.path.base;
  }

  /** Load and display the resources for the spec located at `specUri`. */
  async showFor(specUri: string, title: string): Promise<void> {
    const slug = this.slugFromUri(specUri);
    if (!slug) {
      this.state = undefined;
      this.update();
      return;
    }
    this.state = { slug, specUri, title, resources: await this.loadResources(specUri, slug) };
    this.update();
  }

  private async reload(): Promise<void> {
    if (!this.state) return;
    const { slug, specUri, title } = this.state;
    this.state = { slug, specUri, title, resources: await this.loadResources(specUri, slug) };
    this.update();
  }

  /** Re-read the context folder for the currently shown spec, if any. */
  async refresh(): Promise<void> {
    await this.reload();
  }

  protected override onActivateRequest(msg: Message): void {
    super.onActivateRequest(msg);
    this.node.focus();
    void this.syncTitle();
  }

  private syncTitle(): void {
    const widget = this.editorManager.currentEditor;
    const uri = widget?.getResourceUri();
    if (!widget || !uri || !this.state || this.state.specUri !== uri.toString()) return;
    const raw = widget.editor.document.getText();
    const parsed = parseFrontmatter(raw);
    const title =
      typeof parsed.data.title === "string" && parsed.data.title.trim()
        ? parsed.data.title.trim()
        : uri.path.base;
    if (title !== this.state.title) {
      this.state = { ...this.state, title };
      this.update();
    }
  }

  private readonly handleAdd = (): void => {
    if (this.state) void this.commands.executeCommand(SpexrCommands.SPEC_ADD_CONTEXT.id, this.state.specUri);
  };

  private readonly handleOpen = (r: SpecResource): void => {
    if (this.state) void this.commands.executeCommand(SpexrCommands.SPEC_CONTEXT_OPEN.id, this.toRef(r));
  };

  private readonly handleRemove = (r: SpecResource): void => {
    if (this.state) void this.commands.executeCommand(SpexrCommands.SPEC_CONTEXT_REMOVE.id, this.toRef(r));
  };

  private toRef(r: SpecResource): object {
    return { specUri: this.state!.specUri, kind: r.kind, label: r.label, href: r.href };
  }

  private affectsCurrent(event: FileOperationEvent): boolean {
    if (!this.state) return false;
    const context = this.contextDir(this.state.specUri, this.state.slug);
    if (!context) return false;
    const prefix = context.dir.toString() + "/";
    const candidates = [event.resource, event.target?.resource].filter(
      (u): u is URI => u !== undefined,
    );
    return candidates.some((uri) => uri.toString().startsWith(prefix));
  }

  private slugFromUri(specUri: string): string | undefined {
    const name = specUri.split("/").pop() ?? "";
    return name.match(SPEC_SLUG_RE)?.[1];
  }

  /**
   * The tracked spec's own `.context/<slug>/` folder, with the workspace folder
   * that owns it.
   *
   * Resolved from the spec URI rather than the first workspace folder: spec
   * numbering is per folder, so two folders can hold the same slug, and the
   * superpowers layout keeps its context beside its own specs.
   */
  private contextDir(specUri: string, slug: string): { root: URI; dir: URI } | undefined {
    const roots = this.workspace.tryGetRoots().map((root) => root.resource);
    const located = locateSpec(roots, new URI(specUri));
    if (!located) return undefined;
    return { root: located.root, dir: located.specsDir.resolve(SPEC_CONTEXT_DIR).resolve(slug) };
  }

  private async loadResources(specUri: string, slug: string): Promise<SpecResource[]> {
    const context = this.contextDir(specUri, slug);
    if (!context) return [];
    const { root, dir } = context;
    const base = root.relative(dir)?.toString() ?? `${SPEC_CONTEXT_DIR}/${slug}`;
    const resources: SpecResource[] = [];
    try {
      const stat = await this.fileService.resolve(dir);
      for (const child of (stat.children ?? []).filter((c) => c.isFile)) {
        if (child.name === "_links.md") {
          resources.push(...(await this.parseLinks(child.resource, `${base}/_links.md`)));
          continue;
        }
        resources.push({ kind: "file", label: child.name, storedAt: `${base}/${child.name}` });
      }
    } catch {
      // No context folder yet — spec has no attached resources.
    }
    return resources.sort((a, b) => a.label.localeCompare(b.label));
  }

  /** Extract `- [label](url)` entries from a `_links.md` file. */
  private async parseLinks(uri: URI, storedAt: string): Promise<SpecResource[]> {
    try {
      const file = await this.fileService.read(uri);
      const out: SpecResource[] = [];
      for (const line of file.value.split("\n")) {
        const m = line.match(LINK_LINE_RE);
        if (!m) continue;
        const href = safeHref(m[2]!);
        out.push({ kind: "link", label: m[1]!, ...(href ? { href } : {}), storedAt });
      }
      return out;
    } catch {
      return [];
    }
  }

  protected render(): React.ReactNode {
    return (
      <SpecResourcesPanel
        state={this.state}
        onAdd={this.handleAdd}
        onOpen={this.handleOpen}
        onRemove={this.handleRemove}
      />
    );
  }
}

interface SpecResourcesPanelProps {
  readonly state: ResourcesState | undefined;
  readonly onAdd: () => void;
  readonly onOpen: (r: SpecResource) => void;
  readonly onRemove: (r: SpecResource) => void;
}

const SpecResourcesPanel: React.FC<SpecResourcesPanelProps> = ({ state, onAdd, onOpen, onRemove }) => {
  if (!state) {
    return (
      <section className="spexr-spec-resources" aria-label="Linked resources">
        <p className="spexr-spec-resources__empty">Open a spec to see its linked resources.</p>
      </section>
    );
  }
  return (
    <section className="spexr-spec-resources" aria-label="Linked resources">
      <header className="spexr-spec-resources__header">
        <span className="spexr-spec-resources__caption">
          {state.resources.length === 1 ? "resource" : "resources"}
        </span>
        <button
          type="button"
          className="spexr-button spexr-button--primary spexr-button--compact"
          onClick={onAdd}
          aria-label={`Add a resource to ${state.title}`}
        >
          Add resource
        </button>
      </header>
      {state.resources.length === 0 ? (
        <p className="spexr-spec-resources__empty">
          No resources attached yet. Use <strong>Add resource</strong> to attach files or links.
        </p>
      ) : (
        <ul className="spexr-spec-resources__list" role="list">
          {state.resources.map((r) => (
            <li key={`${r.kind}:${r.storedAt}:${r.label}`} className="spexr-spec-resources__item">
              <span className="spexr-spec-resources__badge">{r.kind === "link" ? "Link" : "File"}</span>
              {r.href ? (
                <a href={r.href} target="_blank" rel="noreferrer" title={r.href}>
                  {r.label}
                </a>
              ) : (
                <span className="spexr-spec-resources__label">{r.label}</span>
              )}
              <code className="spexr-spec-resources__path" title={r.storedAt}>
                {r.storedAt}
              </code>
              <span className="spexr-spec-resources__actions">
                {r.kind === "file" ? (
                  <button
                    type="button"
                    className="spexr-button spexr-button--ghost spexr-button--compact"
                    onClick={() => onOpen(r)}
                    aria-label={`Open ${r.label}`}
                  >
                    Open
                  </button>
                ) : null}
                <button
                  type="button"
                  className="spexr-button spexr-button--ghost spexr-button--compact spexr-button--danger"
                  onClick={() => onRemove(r)}
                  aria-label={`Remove ${r.label}`}
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};
