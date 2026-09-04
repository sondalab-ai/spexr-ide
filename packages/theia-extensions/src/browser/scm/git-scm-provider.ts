import { injectable, inject } from "@theia/core/shared/inversify";
import { Emitter, DisposableCollection } from "@theia/core";
import type { Event } from "@theia/core";
import { OpenerService, open } from "@theia/core/lib/browser";
import { DiffUris } from "@theia/core/lib/browser/diff-uris";
import URI from "@theia/core/lib/common/uri";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { ScmService } from "@theia/scm/lib/browser/scm-service";
import type { ScmRepository } from "@theia/scm/lib/browser/scm-repository";
import type {
  ScmProvider,
  ScmResourceGroup,
  ScmResource,
  ScmResourceDecorations,
} from "@theia/scm/lib/browser/scm-provider";
import { SpexrGitServiceProxySymbol } from "./git-service-proxy.js";
import { GIT_ORIGINAL_SCHEME } from "./git-original-resource.js";
import type {
  SpexrGitService,
  GitFileState,
  GitConflictKind,
  GitBranchDto,
  GitStatusDto,
} from "../../common/git-protocol.js";
import { SpexrGitClientToken, type SpexrGitClientDispatcher } from "./git-client.js";
import { SingleFlight } from "./single-flight.js";

// Display glyphs following VS Code's own SCM decoration convention ("U" for
// untracked, "!" for conflicted) — not the protocol's GitFileState letters,
// which AC-15 deliberately keeps "?" and "U" apart on.
const STATE_LETTER: Record<GitFileState, string> = {
  A: "A",
  M: "M",
  D: "D",
  R: "R",
  C: "C",
  U: "!",
  "?": "U",
};

/**
 * Represents a single changed file in the SCM resource list.
 *
 * Uses `as unknown as URI` casts at the group boundary because @theia/scm
 * bundles its own nested @theia/core, causing TypeScript to see two
 * incompatible declarations of the same private field `codeUri`.
 * At runtime, both URI classes are identical.
 */
class GitScmResource {
  constructor(
    readonly group: GitScmResourceGroup,
    readonly sourceUri: URI,
    readonly decorations: ScmResourceDecorations,
    private readonly openHandler: () => Promise<void>,
    /**
     * Which conflict this row is, on conflict rows only. Command visibility
     * reads it off the row: a delete/modify conflict offers two resolutions
     * where the others offer one, and the menus must differ accordingly.
     */
    readonly conflict?: GitConflictKind,
  ) {}

  async open(): Promise<void> {
    await this.openHandler();
  }
}

class GitScmResourceGroup implements ScmResourceGroup {
  private _resources: GitScmResource[] = [];
  private readonly _onDidChangeEmitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChangeEmitter.event;
  hideWhenEmpty = false;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly provider: ScmProvider,
  ) {}

  get resources(): ScmResource[] {
    // Cast needed: @theia/scm bundles its own @theia/core so URI types diverge.
    return this._resources as unknown as ScmResource[];
  }

  updateResources(resources: GitScmResource[]): void {
    this._resources = resources;
    this._onDidChangeEmitter.fire();
  }

  dispose(): void {
    this._onDidChangeEmitter.dispose();
  }
}

/**
 * One instance per repository. {@link SpexrGitScmRegistry} owns the lifecycle:
 * it resolves the workspace folders to repository top levels, calls
 * {@link init} once per distinct one, and disposes the provider when that
 * repository leaves the workspace. Bound transiently for that reason — a
 * singleton could only ever describe one repository, which is exactly the
 * multi-root bug this replaced.
 */
@injectable()
export class SpexrGitScmProvider implements ScmProvider {
  readonly id = "spexr-git";
  readonly label = "Git";

  @inject(SpexrGitServiceProxySymbol)
  private readonly gitService!: SpexrGitService;

  @inject(ScmService)
  private readonly scmService!: ScmService;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(OpenerService)
  private readonly openerService!: OpenerService;

  @inject(SpexrGitClientToken)
  private readonly gitClient!: SpexrGitClientDispatcher;

  private readonly refresher = new SingleFlight(() => this.doRefresh());

  private readonly _onDidChangeEmitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChangeEmitter.event;

  private readonly _onDidChangeCommitTemplateEmitter = new Emitter<string>();
  readonly onDidChangeCommitTemplate: Event<string> = this._onDidChangeCommitTemplateEmitter.event;

  private readonly _onDidChangeStatusEmitter = new Emitter<GitStatusDto | undefined>();
  /**
   * Last known status, so consumers need not spawn their own git process.
   * Fires `undefined` when a refresh fails, so a status-bar-style consumer
   * can clear itself instead of showing a status the panel no longer has.
   */
  readonly onDidChangeStatus: Event<GitStatusDto | undefined> =
    this._onDidChangeStatusEmitter.event;

  private _lastStatus: GitStatusDto | undefined;

  /**
   * Most recent status, for consumers that start after the first refresh and
   * would otherwise miss it on `onDidChangeStatus` (e.g. the status bar).
   */
  get lastStatus(): GitStatusDto | undefined {
    return this._lastStatus;
  }

  private readonly conflictGroup = new GitScmResourceGroup(
    "conflicts",
    "Merge Conflicts",
    this as unknown as ScmProvider,
  );
  private readonly indexGroup = new GitScmResourceGroup(
    "index",
    "Staged Changes",
    this as unknown as ScmProvider,
  );
  private readonly workingTreeGroup = new GitScmResourceGroup(
    "workingTree",
    "Changes",
    this as unknown as ScmProvider,
  );

  private readonly toDispose = new DisposableCollection();

  /** Filesystem path of the workspace root (used for git operations). */
  private rootFsPath: string | undefined;

  /** URI string of the workspace root (returned by ScmProvider.rootUri). */
  private rootUriStr = "";

  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  private disposed = false;

  /** The registered repository, kept for its commit-message input box. */
  private repository: ScmRepository | undefined;

  readonly acceptInputCommand = { command: "spexr.git.commitFromPanel", title: "Commit" };

  constructor() {
    // Unlike the other two groups, an empty conflict group should not take up
    // space in the SCM panel — most refreshes have no conflicts at all.
    this.conflictGroup.hideWhenEmpty = true;
  }

  /** Current text of the commit-message input box. */
  get inputValue(): string {
    return this.repository?.input.value ?? "";
  }

  /**
   * Write a message into the commit-message input box. False when there is no box
   * to write to — the box is created in `init`, so this is false on a provider
   * the registry has not bound to a repository yet.
   */
  setInputValue(message: string): boolean {
    if (!this.repository) return false;
    this.repository.input.value = message;
    return true;
  }

  get groups(): ScmResourceGroup[] {
    return [this.conflictGroup, this.indexGroup, this.workingTreeGroup];
  }

  get rootUri(): string {
    return this.rootUriStr;
  }

  /** Filesystem path of the repository root, or undefined before {@link init}. */
  get root(): string | undefined {
    return this.rootFsPath;
  }

  /**
   * Bind this provider to one repository and register it with the SCM service.
   * `repoRoot` is a repository top level, not a workspace folder: statuses come
   * back relative to it, so a folder nested in a repository must be resolved
   * first (see `SpexrGitService.resolveToplevel`).
   */
  async init(repoRoot: string, repoRootUri: URI): Promise<void> {
    this.rootFsPath = repoRoot;
    this.rootUriStr = repoRootUri.toString();

    const repository = this.scmService.registerScmProvider(this as unknown as ScmProvider);
    this.repository = repository;
    repository.input.placeholder = "Message (press Ctrl/Cmd+Enter to commit)";
    this.toDispose.push(repository);
    this.toDispose.push(this.fileService.onDidFilesChange(() => this.scheduleRefresh()));
    this.toDispose.push(this.gitClient.onRepositoryChanged$(() => this.scheduleRefresh()));

    await this.refresh();
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), 200);
  }

  async refresh(): Promise<void> {
    await this.refresher.run();
  }

  private async doRefresh(): Promise<void> {
    if (!this.rootFsPath) return;
    try {
      const status = await this.gitService.getStatus(this.rootFsPath);
      this._lastStatus = status;
      this._onDidChangeStatusEmitter.fire(status);
      const root = this.rootFsPath;

      // A conflicted path reports only unstagedState: "U" (mapFileChange never
      // sets stagedState alongside it), so this exclusion is belt-and-braces:
      // the staged/unstaged filters below already can't match it.
      const conflicted = status.files.filter((f) => f.unstagedState === "U");
      const conflictPaths = new Set(conflicted.map((f) => f.path));

      const conflicts = conflicted.map((f) => {
        const fileUri = buildFileUri(root, f.path);
        return new GitScmResource(
          this.conflictGroup,
          fileUri,
          { letter: STATE_LETTER[f.unstagedState!], tooltip: stateLabel(f.unstagedState!) },
          async () => {
            await open(this.openerService, fileUri);
          },
          f.conflict,
        );
      });

      const staged = status.files
        .filter((f) => f.stagedState !== undefined && !conflictPaths.has(f.path))
        .map((f) => {
          const isNew = f.stagedState === "A";
          const fileUri = buildFileUri(root, f.path);
          return new GitScmResource(
            this.indexGroup,
            fileUri,
            { letter: STATE_LETTER[f.stagedState!], tooltip: stateLabel(f.stagedState!) },
            () => this.openDiff(fileUri, f.path, ":0", isNew),
          );
        });

      const unstaged = status.files
        .filter((f) => f.unstagedState !== undefined && f.unstagedState !== "U")
        .map((f) => {
          const isNew = f.unstagedState === "?";
          const fileUri = buildFileUri(root, f.path);
          return new GitScmResource(
            this.workingTreeGroup,
            fileUri,
            { letter: STATE_LETTER[f.unstagedState!], tooltip: stateLabel(f.unstagedState!) },
            () => this.openDiff(fileUri, f.path, "HEAD", isNew),
          );
        });

      this.conflictGroup.updateResources(conflicts);
      this.indexGroup.updateResources(staged);
      this.workingTreeGroup.updateResources(unstaged);
      this._onDidChangeEmitter.fire();
    } catch {
      // Non-git workspace: clear groups silently. Also clear the status the
      // status bar is holding — otherwise it keeps showing e.g. "main ↑2"
      // for a repository the panel no longer has any status for.
      this.conflictGroup.updateResources([]);
      this.indexGroup.updateResources([]);
      this.workingTreeGroup.updateResources([]);
      this._lastStatus = undefined;
      this._onDidChangeStatusEmitter.fire(undefined);
    }
  }

  private async openDiff(
    fileUri: URI,
    filePath: string,
    rev: string,
    isNew: boolean,
  ): Promise<void> {
    if (isNew || !this.rootFsPath) {
      await open(this.openerService, fileUri);
      return;
    }
    const root = this.rootFsPath;
    const originalUri = URI.fromComponents({
      scheme: GIT_ORIGINAL_SCHEME,
      authority: "",
      path: `/${filePath}`,
      query: `root=${encodeURIComponent(root)}&rev=${encodeURIComponent(rev)}`,
      fragment: "",
    });
    const label = `${filePath.split("/").pop() ?? filePath} (${rev === ":0" ? "Index" : "Working Tree"})`;
    const diffUri = DiffUris.encode(originalUri, fileUri, label);
    await open(this.openerService, diffUri);
  }

  // --- Operations called by git-commands-contribution.ts ---

  async stage(paths: string[]): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.stage(this.rootFsPath, paths);
    await this.refresh();
  }

  async unstage(paths: string[]): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.unstage(this.rootFsPath, paths);
    await this.refresh();
  }

  async discard(paths: string[]): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.discard(this.rootFsPath, paths);
    await this.refresh();
  }

  /** Accept a deletion: `git rm` the paths, staging the removal. */
  async removePath(paths: string[]): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.removePath(this.rootFsPath, paths);
    await this.refresh();
  }

  async commit(message: string): Promise<void> {
    if (!this.rootFsPath) return;
    if (!message.trim()) throw new Error("Commit message cannot be empty.");
    await this.gitService.commit(this.rootFsPath, message);
    await this.refresh();
  }

  /** Ask the backend's local model for a commit subject; null when it has none to offer. */
  async generateCommitMessage(): Promise<string | null> {
    if (!this.rootFsPath) return null;
    return this.gitService.generateCommitMessage(this.rootFsPath);
  }

  async push(): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.push(this.rootFsPath);
    await this.refresh();
  }

  async pull(): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.pull(this.rootFsPath);
    await this.refresh();
  }

  async fetch(): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.fetch(this.rootFsPath);
    await this.refresh();
  }

  async checkout(branch: string): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.checkout(this.rootFsPath, branch);
    await this.refresh();
  }

  async createBranch(name: string, checkoutAfter: boolean): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.createBranch(this.rootFsPath, name, checkoutAfter);
    await this.refresh();
  }

  async getBranches(): Promise<GitBranchDto[]> {
    if (!this.rootFsPath) return [];
    return this.gitService.getBranches(this.rootFsPath);
  }

  /**
   * Idempotent and re-entrant by design: `toDispose` holds the ScmRepository,
   * whose own disposal chain disposes its provider — us — right back. The guard
   * makes that cycle terminate whichever end starts it, so the registry can
   * simply call `dispose()` when a repository leaves the workspace.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.toDispose.dispose();
    this._onDidChangeEmitter.dispose();
    this._onDidChangeCommitTemplateEmitter.dispose();
    this._onDidChangeStatusEmitter.dispose();
    this.conflictGroup.dispose();
    this.indexGroup.dispose();
    this.workingTreeGroup.dispose();
  }
}

export function buildFileUri(root: string, filePath: string): URI {
  // String concatenation truncates paths containing "#" or "?" (parsed as
  // fragment/query by the URI parser) — build from components instead, as
  // openDiff above already does. Exported so the decorations provider builds
  // the identical URI the tree looks decorations up by.
  return URI.fromComponents({
    scheme: "file",
    authority: "",
    path: `${root}/${filePath}`,
    query: "",
    fragment: "",
  });
}

function stateLabel(state: GitFileState): string {
  const labels: Record<GitFileState, string> = {
    A: "Added",
    M: "Modified",
    D: "Deleted",
    R: "Renamed",
    C: "Copied",
    U: "Conflicted",
    "?": "Untracked",
  };
  return labels[state];
}
