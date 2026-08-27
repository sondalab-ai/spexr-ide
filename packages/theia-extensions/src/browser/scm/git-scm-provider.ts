import { injectable, inject } from "@theia/core/shared/inversify";
import { Emitter, DisposableCollection } from "@theia/core";
import type { Event } from "@theia/core";
import type { FrontendApplicationContribution} from "@theia/core/lib/browser";
import { OpenerService, open } from "@theia/core/lib/browser";
import { DiffUris } from "@theia/core/lib/browser/diff-uris";
import URI from "@theia/core/lib/common/uri";
import { FileService } from "@theia/filesystem/lib/browser/file-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import { MessageService } from "@theia/core/lib/common/message-service";
import { ScmService } from "@theia/scm/lib/browser/scm-service";
import type {
  ScmProvider,
  ScmResourceGroup,
  ScmResource,
  ScmResourceDecorations,
} from "@theia/scm/lib/browser/scm-provider";
import { SpexrGitServiceProxySymbol } from "./git-service-proxy.js";
import { GIT_ORIGINAL_SCHEME } from "./git-original-resource.js";
import type { SpexrGitService, GitFileState, GitBranchDto, GitStatusDto } from "../../common/git-protocol.js";
import { SpexrGitClientToken, type SpexrGitClientDispatcher } from "./git-client.js";
import { SingleFlight } from "./single-flight.js";

const STATE_LETTER: Record<GitFileState, string> = {
  A: "A", M: "M", D: "D", R: "R", U: "U", C: "C",
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

@injectable()
export class SpexrGitScmProvider implements ScmProvider, FrontendApplicationContribution {
  readonly id = "spexr-git";
  readonly label = "Git";

  @inject(SpexrGitServiceProxySymbol)
  private readonly gitService!: SpexrGitService;

  @inject(ScmService)
  private readonly scmService!: ScmService;

  @inject(FileService)
  private readonly fileService!: FileService;

  @inject(WorkspaceService)
  private readonly workspaceService!: WorkspaceService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  @inject(OpenerService)
  private readonly openerService!: OpenerService;

  @inject(SpexrGitClientToken)
  private readonly gitClient!: SpexrGitClientDispatcher;

  private readonly refresher = new SingleFlight(() => this.doRefresh());

  private readonly _onDidChangeEmitter = new Emitter<void>();
  readonly onDidChange: Event<void> = this._onDidChangeEmitter.event;

  private readonly _onDidChangeCommitTemplateEmitter = new Emitter<string>();
  readonly onDidChangeCommitTemplate: Event<string> = this._onDidChangeCommitTemplateEmitter.event;

  private readonly _onDidChangeStatusEmitter = new Emitter<GitStatusDto>();
  /** Last known status, so consumers need not spawn their own git process. */
  readonly onDidChangeStatus: Event<GitStatusDto> = this._onDidChangeStatusEmitter.event;

  private readonly indexGroup = new GitScmResourceGroup("index", "Staged Changes", this as unknown as ScmProvider);
  private readonly workingTreeGroup = new GitScmResourceGroup("workingTree", "Changes", this as unknown as ScmProvider);

  private readonly toDispose = new DisposableCollection();

  /** Filesystem path of the workspace root (used for git operations). */
  private rootFsPath: string | undefined;

  /** URI string of the workspace root (returned by ScmProvider.rootUri). */
  private rootUriStr = "";

  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  readonly acceptInputCommand = { command: "spexr.git.commitFromPanel", title: "Commit" };

  get groups(): ScmResourceGroup[] {
    return [this.indexGroup, this.workingTreeGroup];
  }

  get rootUri(): string {
    return this.rootUriStr;
  }

  /** Filesystem path of the repository root, or undefined outside a workspace. */
  get root(): string | undefined {
    return this.rootFsPath;
  }

  async onStart(): Promise<void> {
    const [first] = this.workspaceService.tryGetRoots();
    if (!first) return;
    this.rootFsPath = first.resource.path.toString();
    this.rootUriStr = first.resource.toString();

    const repository = this.scmService.registerScmProvider(this as unknown as ScmProvider);
    repository.input.placeholder = "Message (press Ctrl/Cmd+Enter to commit)";
    this.toDispose.push(repository);
    this.toDispose.push(
      this.fileService.onDidFilesChange(() => this.scheduleRefresh()),
    );
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
      this._onDidChangeStatusEmitter.fire(status);
      const root = this.rootFsPath;

      const staged = status.files
        .filter((f) => f.stagedState !== undefined)
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
        .filter((f) => f.unstagedState !== undefined)
        .map((f) => {
          const isNew = f.unstagedState === "U";
          const fileUri = buildFileUri(root, f.path);
          return new GitScmResource(
            this.workingTreeGroup,
            fileUri,
            { letter: STATE_LETTER[f.unstagedState!], tooltip: stateLabel(f.unstagedState!) },
            () => this.openDiff(fileUri, f.path, "HEAD", isNew),
          );
        });

      this.indexGroup.updateResources(staged);
      this.workingTreeGroup.updateResources(unstaged);
      this._onDidChangeEmitter.fire();
    } catch {
      // Non-git workspace: clear groups silently.
      this.indexGroup.updateResources([]);
      this.workingTreeGroup.updateResources([]);
    }
  }

  private async openDiff(fileUri: URI, filePath: string, rev: string, isNew: boolean): Promise<void> {
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

  async commit(message: string): Promise<void> {
    if (!this.rootFsPath) return;
    if (!message.trim()) throw new Error("Commit message cannot be empty.");
    await this.gitService.commit(this.rootFsPath, message);
    await this.refresh();
  }

  async push(remote?: string, branch?: string): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.push(this.rootFsPath, remote, branch);
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

  async showError(message: string): Promise<void> {
    await this.messages.error(message);
  }

  dispose(): void {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer);
    this.toDispose.dispose();
    this._onDidChangeEmitter.dispose();
    this._onDidChangeCommitTemplateEmitter.dispose();
    this._onDidChangeStatusEmitter.dispose();
    this.indexGroup.dispose();
    this.workingTreeGroup.dispose();
  }
}

function buildFileUri(root: string, filePath: string): URI {
  return new URI(`file://${root}/${filePath}`);
}

function stateLabel(state: GitFileState): string {
  const labels: Record<GitFileState, string> = {
    A: "Added", M: "Modified", D: "Deleted",
    R: "Renamed", U: "Untracked", C: "Conflicted",
  };
  return labels[state];
}
