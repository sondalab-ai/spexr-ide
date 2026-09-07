import { injectable, inject } from "@theia/core/shared/inversify";
import { Emitter, DisposableCollection, Disposable } from "@theia/core";
import type { Event } from "@theia/core";
import type { FrontendApplicationContribution } from "@theia/core/lib/browser";
import URI from "@theia/core/lib/common/uri";
import { PreferenceService } from "@theia/core/lib/common/preferences/preference-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { ScmService } from "@theia/scm/lib/browser/scm-service";
import { SpexrGitServiceProxySymbol } from "./git-service-proxy.js";
import type { SpexrGitService } from "../../common/git-protocol.js";
import type { SpexrGitScmProvider } from "./git-scm-provider.js";
import { distinctRepoRoots, type RepoRootMapping } from "./git-repo-roots.js";
import { SingleFlight } from "./single-flight.js";
import { BACKGROUND_FETCH_INTERVAL_MS, shouldFetchNow } from "./background-fetch-policy.js";
import { SPEXR_GIT_AUTOFETCH_PREFERENCE } from "../preferences/spexr-preferences.js";

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

  @inject(PreferenceService)
  private readonly preferences!: PreferenceService;

  @inject(SpexrGitScmProviderFactory)
  private readonly createProvider!: SpexrGitScmProviderFactory;

  /** Keyed by repository top level, in workspace-folder order. */
  private readonly providers = new Map<string, ProviderEntry>();

  private readonly toDispose = new DisposableCollection();

  private readonly syncer = new SingleFlight(() => this.syncProviders());

  private fetchTimer: ReturnType<typeof setInterval> | undefined;

  /** When the last background fetch started, so the timer and focus share a floor. */
  private lastFetchAt: number | undefined;

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
    this.startBackgroundFetch();
  }

  /**
   * Keep divergence from the remote truthful between user actions. Without
   * this, `behind` only ever moves when someone presses Fetch or Pull by hand,
   * so "N behind" in the status bar — and any warning built on it — is stale
   * for as long as the IDE stays open.
   *
   * One timer here rather than one per provider: the registry already owns the
   * repository set and its own lifecycle. Regaining focus also fetches, which
   * is when a user is most likely to be about to act on the number.
   *
   * Switched off by `spexr.git.autofetch`, for a metered connection or a
   * network where an unattended authentication attempt is unwelcome.
   */
  private startBackgroundFetch(): void {
    this.fetchTimer = setInterval(() => void this.fetchAll(), BACKGROUND_FETCH_INTERVAL_MS);
    const onFocus = (): void => void this.fetchAll();
    window.addEventListener("focus", onFocus);
    this.toDispose.push(Disposable.create(() => window.removeEventListener("focus", onFocus)));
  }

  /**
   * Fetch every repository, at most once per interval however many triggers
   * fire. Providers swallow their own failures, so this never rejects.
   */
  private async fetchAll(): Promise<void> {
    // Read per tick rather than subscribing: turning the preference off then
    // takes effect at the next tick with no listener to keep in sync.
    if (!this.preferences.get<boolean>(SPEXR_GIT_AUTOFETCH_PREFERENCE, true)) return;
    const now = Date.now();
    if (!shouldFetchNow(this.lastFetchAt, now)) return;
    this.lastFetchAt = now;
    await Promise.all(this.all.map((p) => p.backgroundFetch()));
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
    if (this.fetchTimer !== undefined) clearInterval(this.fetchTimer);
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
