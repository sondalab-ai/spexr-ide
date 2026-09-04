import { injectable, inject } from "@theia/core/shared/inversify";
import { Emitter } from "@theia/core";
import type { Event } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import type URI from "@theia/core/lib/common/uri";
import {
  DecorationsService,
  type DecorationsProvider,
  type Decoration,
} from "@theia/core/lib/browser/decorations-service";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { SpexrGitServiceProxySymbol } from "./git-service-proxy.js";
import type { SpexrGitService } from "../../common/git-protocol.js";
import { buildIgnoreMatcher } from "./git-ignore-matcher.js";
import { containingRoot } from "./git-repo-roots.js";

/** One workspace folder's ignore set, resolved relative to that folder. */
interface RootIgnores {
  readonly uri: URI;
  readonly isIgnored: (rel: string) => boolean;
}

/**
 * Dims git-ignored files/folders in the file navigator. SPEXR ships a custom SCM
 * (no `@theia/git`), so the standard ignored-resource decorations are absent — this
 * restores them by registering a {@link DecorationsProvider} with the
 * {@link DecorationsService}, which the filesystem tree already consumes.
 *
 * Keeps one ignore set per workspace folder, since the navigator shows them all:
 * `git ls-files` reports paths relative to the directory it runs in, so each
 * folder gets its own matcher and a decoration lookup picks the folder that
 * contains the URI (the deepest one, when folders nest). Folders outside a
 * repository simply contribute an empty set.
 *
 * The sets are refreshed on file changes and whenever the workspace folders change.
 * The tree adapter builds its decoration cache from the URIs we emit via
 * {@link onDidChange}, so each refresh emits the ignored URIs.
 */
@injectable()
export class GitIgnoredDecorationProvider
  implements DecorationsProvider, FrontendApplicationContribution
{
  @inject(SpexrGitServiceProxySymbol) private readonly gitService!: SpexrGitService;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(FileService) private readonly fileService!: FileService;
  @inject(DecorationsService) private readonly decorations!: DecorationsService;

  private readonly onDidChangeEmitter = new Emitter<URI[]>();
  readonly onDidChange: Event<URI[]> = this.onDidChangeEmitter.event;

  /** Keyed by the folder's filesystem path — what {@link containingRoot} matches on. */
  private roots = new Map<string, RootIgnores>();
  private ignoredUris: URI[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  async onStart(): Promise<void> {
    this.decorations.registerDecorationsProvider(this);
    this.fileService.onDidFilesChange(() => this.scheduleRefresh());
    this.workspace.onWorkspaceChanged(() => this.scheduleRefresh());
    await this.refresh();
  }

  provideDecorations(uri: URI): Decoration | undefined {
    const rootPath = containingRoot([...this.roots.keys()], uri.path.toString());
    if (rootPath === undefined) return undefined;
    const entry = this.roots.get(rootPath);
    if (!entry) return undefined;
    const rel = entry.uri.relative(uri);
    if (!rel) return undefined;
    const relStr = rel.toString();
    if (relStr.length === 0 || !entry.isIgnored(relStr)) return undefined;
    return { colorId: "disabledForeground", tooltip: "Ignored by git", weight: 10 };
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 400);
  }

  private async refresh(): Promise<void> {
    const roots = this.workspace.tryGetRoots();
    const next = new Map<string, RootIgnores>();
    const nextUris: URI[] = [];
    // One `ls-files` per folder, in parallel: they run against different
    // directories, so serializing them would only add latency.
    const perRoot = await Promise.all(
      roots.map(async (root) => {
        let paths: string[] = [];
        try {
          paths = await this.gitService.getIgnoredPaths(root.resource.path.toString());
        } catch {
          paths = [];
        }
        return { root, paths };
      }),
    );
    for (const { root, paths } of perRoot) {
      next.set(root.resource.path.toString(), {
        uri: root.resource,
        isIgnored: buildIgnoreMatcher(paths),
      });
      for (const p of paths) nextUris.push(root.resource.resolve(p.replace(/\/$/, "")));
    }
    this.roots = next;
    // Emit the previous + current ignored URIs so the tree adapter re-queries both the
    // ones to newly dim and the ones to clear.
    const previous = this.ignoredUris;
    this.ignoredUris = nextUris;
    this.onDidChangeEmitter.fire([...previous, ...this.ignoredUris]);
  }

  dispose(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.onDidChangeEmitter.dispose();
  }
}
