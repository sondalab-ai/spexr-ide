import { injectable, inject } from "@theia/core/shared/inversify";
import { Emitter, DisposableCollection } from "@theia/core";
import type { Event } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import URI from "@theia/core/lib/common/uri";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { ScmService } from "@theia/scm/lib/browser/scm-service";
import { SpexrGitServiceProxySymbol } from "./git-service-proxy.js";
import type { SpexrGitService } from "../../common/git-protocol.js";
import type { SpexrGitScmProvider } from "./git-scm-provider.js";
import { distinctRepoRoots, type RepoRootMapping } from "./git-repo-roots.js";
import { SingleFlight } from "./single-flight.js";

/** A registered repository: its provider and the registry's own subscriptions to it. */
interface ProviderEntry {
  readonly provider: SpexrGitScmProvider;
  readonly toDispose: DisposableCollection;
}

/** Creates an unbound {@link SpexrGitScmProvider}; the registry calls `init` on it. */
export type SpexrGitScmProviderFactory = () => SpexrGitScmProvider;
export const SpexrGitScmProviderFactory = Symbol("SpexrGitScmProviderFactory");

/**
 * Owns one {@link SpexrGitScmProvider} per repository in the workspace.
 *
 * A multi-root workspace holds several folders, and previously only the first
 * one ever reached the SCM panel. The registry resolves every folder to its
 * repository top level, collapses the folders that share one, and registers a
 * provider per distinct repository — Theia's SCM panel then shows them behind
 * its own repository picker (`scm.change-repository`).
 *
 * Consumers split along one line: anything scoped to the panel (commands, the
 * branch status bar) follows {@link active}, while anything that decorates the
 * file tree must union over {@link all}, since the tree shows every folder at
 * once.
 */
@injectable()
export class SpexrGitScmRegistry implements FrontendApplicationContribution {
  @inject(WorkspaceService)
  private readonly workspace!: WorkspaceService;

  @inject(SpexrGitServiceProxySymbol)
  private readonly gitService!: SpexrGitService;

  @inject(ScmService)
  private readonly scmService!: ScmService;

  @inject(SpexrGitScmProviderFactory)
  private readonly createProvider!: SpexrGitScmProviderFactory;

  /** Keyed by repository top level, in workspace-folder order. */
  private readonly providers = new Map<string, ProviderEntry>();

  private readonly toDispose = new DisposableCollection();

  private readonly syncer = new SingleFlight(() => this.syncProviders());

  private readonly onDidChangeProvidersEmitter = new Emitter<void>();
  /** A repository joined or left the workspace. */
  readonly onDidChangeProviders: Event<void> = this.onDidChangeProvidersEmitter.event;

  private readonly onDidChangeStatusEmitter = new Emitter<void>();
  /**
   * Any repository's status changed. Deliberately carries no payload: every
   * consumer either re-reads {@link active} or unions over {@link all}, and
   * neither is served by knowing which single provider fired.
   */
  readonly onDidChangeStatus: Event<void> = this.onDidChangeStatusEmitter.event;

  /** The repository the SCM panel is showing changed. */
  get onDidChangeActive(): Event<unknown> {
    return this.scmService.onDidChangeSelectedRepository;
  }

  /** Every repository in the workspace, in workspace-folder order. */
  get all(): SpexrGitScmProvider[] {
    return [...this.providers.values()].map((e) => e.provider);
  }

  /**
   * The repository the SCM panel currently shows, which is what a panel command
   * acts on. Undefined outside a repository, or before the first sync.
   */
  get active(): SpexrGitScmProvider | undefined {
    const selected = this.scmService.selectedRepository;
    if (!selected) return undefined;
    return this.all.find((p) => p.rootUri === selected.provider.rootUri);
  }

  async onStart(): Promise<void> {
    this.toDispose.push(this.workspace.onWorkspaceChanged(() => void this.sync()));
    await this.sync();
  }

  /** Reconcile the registered repositories with the workspace folders. */
  async sync(): Promise<void> {
    await this.syncer.run();
  }

  private async syncProviders(): Promise<void> {
    const roots = this.workspace.tryGetRoots();
    // Resolved in parallel: each is one `rev-parse` on the backend, and they
    // run against different repositories so nothing serializes them anyway.
    const mappings: (RepoRootMapping & { uri: URI })[] = await Promise.all(
      roots.map(async (root) => {
        const path = root.resource.path.toString();
        return {
          root: path,
          uri: root.resource,
          toplevel: await this.resolveToplevel(path),
        };
      }),
    );
    const wanted = distinctRepoRoots(mappings);

    let changed = false;
    for (const [repoRoot, entry] of [...this.providers]) {
      if (wanted.includes(repoRoot)) continue;
      entry.toDispose.dispose();
      entry.provider.dispose();
      this.providers.delete(repoRoot);
      changed = true;
    }

    for (const repoRoot of wanted) {
      if (this.providers.has(repoRoot)) continue;
      const provider = this.createProvider();
      const toDispose = new DisposableCollection(
        provider.onDidChangeStatus(() => this.onDidChangeStatusEmitter.fire()),
      );
      this.providers.set(repoRoot, { provider, toDispose });
      try {
        await provider.init(repoRoot, this.rootUriFor(repoRoot, mappings));
      } catch {
        // Registration is the only thing that can fail here, and a half-created
        // provider left in the map would block every later sync from retrying
        // this repository — drop it and carry on with the other folders.
        toDispose.dispose();
        provider.dispose();
        this.providers.delete(repoRoot);
        continue;
      }
      changed = true;
    }

    // Re-insert in workspace-folder order: `wanted` follows it, while the map
    // otherwise keeps whatever order previous syncs left behind.
    const ordered: [string, ProviderEntry][] = [];
    for (const repoRoot of wanted) {
      const entry = this.providers.get(repoRoot);
      if (entry) ordered.push([repoRoot, entry]);
    }
    this.providers.clear();
    for (const [repoRoot, entry] of ordered) this.providers.set(repoRoot, entry);

    if (changed) {
      this.onDidChangeProvidersEmitter.fire();
      this.onDidChangeStatusEmitter.fire();
    }
  }

  /**
   * A workspace folder that is not a repository yields undefined rather than an
   * error: an unversioned folder alongside a checkout is ordinary, and it must
   * not take the whole sync down with it.
   */
  private async resolveToplevel(root: string): Promise<string | undefined> {
    try {
      return await this.gitService.resolveToplevel(root);
    } catch {
      return undefined;
    }
  }

  /**
   * URI for a repository root. The workspace folder's own URI is reused when it
   * *is* the top level, so nothing about the existing single-root case changes;
   * a top level above the opened folder has no URI in the workspace and is
   * built from components (the same construction `buildFileUri` uses, which
   * survives `#` and `?` in a path where concatenation would truncate).
   */
  private rootUriFor(repoRoot: string, mappings: readonly (RepoRootMapping & { uri: URI })[]): URI {
    const exact = mappings.find((m) => m.root === repoRoot);
    if (exact) return exact.uri;
    return URI.fromComponents({
      scheme: "file",
      authority: "",
      path: repoRoot,
      query: "",
      fragment: "",
    });
  }

  dispose(): void {
    for (const entry of this.providers.values()) {
      entry.toDispose.dispose();
      entry.provider.dispose();
    }
    this.providers.clear();
    this.toDispose.dispose();
    this.onDidChangeProvidersEmitter.dispose();
    this.onDidChangeStatusEmitter.dispose();
  }
}
