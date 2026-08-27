import { injectable, inject } from "@theia/core/shared/inversify";
import {
  type CommandContribution,
  type CommandRegistry,
  type Command,
  type MenuContribution,
  type MenuModelRegistry,
  MessageService,
} from "@theia/core";
import { ConfirmDialog, QuickInputService } from "@theia/core/lib/browser";
import { ProgressService } from "@theia/core/lib/common/progress-service";
import { ScmTreeWidget } from "@theia/scm/lib/browser/scm-tree-widget";
import { SpexrGitScmProvider } from "./git-scm-provider.js";
import { toRepoRelative } from "./relative-path.js";

export const GitCommands = {
  STAGE_ALL: { id: "spexr.git.stageAll", label: "Git: Stage All Changes" } satisfies Command,
  UNSTAGE_ALL: { id: "spexr.git.unstageAll", label: "Git: Unstage All Changes" } satisfies Command,
  COMMIT: { id: "spexr.git.commit", label: "Git: Commit Staged Changes" } satisfies Command,
  COMMIT_FROM_PANEL: { id: "spexr.git.commitFromPanel", label: "Commit" } satisfies Command,
  PUSH: { id: "spexr.git.push", label: "Git: Push" } satisfies Command,
  PULL: { id: "spexr.git.pull", label: "Git: Pull" } satisfies Command,
  FETCH: { id: "spexr.git.fetch", label: "Git: Fetch" } satisfies Command,
  CHECKOUT: { id: "spexr.git.checkout", label: "Git: Checkout Branch" } satisfies Command,
  CREATE_BRANCH: { id: "spexr.git.createBranch", label: "Git: Create Branch" } satisfies Command,
  REFRESH: { id: "spexr.git.refresh", label: "Git: Refresh" } satisfies Command,
  STAGE_FILE: { id: "spexr.git.stageFile", label: "Git: Stage File" } satisfies Command,
  UNSTAGE_FILE: { id: "spexr.git.unstageFile", label: "Git: Unstage File" } satisfies Command,
  DISCARD_FILE: { id: "spexr.git.discardFile", label: "Git: Discard File Changes" } satisfies Command,
} as const;

@injectable()
export class SpexrGitCommandsContribution implements CommandContribution, MenuContribution {
  @inject(SpexrGitScmProvider)
  private readonly provider!: SpexrGitScmProvider;

  @inject(QuickInputService)
  private readonly quickInput!: QuickInputService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  @inject(ProgressService)
  private readonly progressService!: ProgressService;

  registerCommands(commands: CommandRegistry): void {
    commands.registerCommand(GitCommands.STAGE_ALL, {
      execute: () => this.runGitOp("Stage changes", () => this.stageAll()),
    });
    commands.registerCommand(GitCommands.UNSTAGE_ALL, {
      execute: () => this.runGitOp("Unstage changes", () => this.unstageAll()),
    });
    commands.registerCommand(GitCommands.COMMIT, {
      execute: () => this.commitWithPrompt(),
    });
    commands.registerCommand(GitCommands.COMMIT_FROM_PANEL, {
      execute: (message: unknown) =>
        this.runGitOp(
          "Commit",
          () => this.provider.commit(typeof message === "string" ? message : ""),
          "Changes committed.",
        ),
    });
    commands.registerCommand(GitCommands.PUSH, {
      execute: () => this.runGitOp("Push", () => this.provider.push(), "Pushed to remote."),
    });
    commands.registerCommand(GitCommands.PULL, {
      execute: () => this.runGitOp("Pull", () => this.provider.pull(), "Pulled from remote."),
    });
    commands.registerCommand(GitCommands.FETCH, {
      execute: () => this.runGitOp("Fetch", () => this.provider.fetch(), "Fetched from remote."),
    });
    commands.registerCommand(GitCommands.CHECKOUT, {
      execute: () => this.checkoutWithPrompt(),
    });
    commands.registerCommand(GitCommands.CREATE_BRANCH, {
      execute: () => this.createBranchWithPrompt(),
    });
    commands.registerCommand(GitCommands.REFRESH, {
      execute: () => this.runGitOp("Refresh", () => this.provider.refresh()),
    });
    commands.registerCommand(GitCommands.STAGE_FILE, {
      execute: (...args: unknown[]) =>
        this.runGitOp("Stage file", () => this.provider.stage(this.pathsOf(args))),
    });
    commands.registerCommand(GitCommands.UNSTAGE_FILE, {
      execute: (...args: unknown[]) =>
        this.runGitOp("Unstage file", () => this.provider.unstage(this.pathsOf(args))),
    });
    commands.registerCommand(GitCommands.DISCARD_FILE, {
      execute: (...args: unknown[]) => this.discardWithConfirm(this.pathsOf(args)),
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_INLINE_MENU, {
      commandId: GitCommands.STAGE_FILE.id,
      label: "Stage",
      icon: "codicon codicon-add",
      order: "1",
    });
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_INLINE_MENU, {
      commandId: GitCommands.DISCARD_FILE.id,
      label: "Discard",
      icon: "codicon codicon-discard",
      order: "2",
    });
    for (const cmd of [GitCommands.STAGE_FILE, GitCommands.UNSTAGE_FILE, GitCommands.DISCARD_FILE]) {
      menus.registerMenuAction(ScmTreeWidget.RESOURCE_CONTEXT_MENU, { commandId: cmd.id, label: cmd.label });
    }
  }

  private async stageAll(): Promise<void> {
    const root = this.provider.root;
    if (!root) return;
    const paths = this.provider.groups
      .find((g) => g.id === "workingTree")
      ?.resources.map((r) => toRepoRelative(root, r.sourceUri.path.toString())) ?? [];
    if (paths.length === 0) return;
    await this.provider.stage(paths);
  }

  private async unstageAll(): Promise<void> {
    const root = this.provider.root;
    if (!root) return;
    const paths = this.provider.groups
      .find((g) => g.id === "index")
      ?.resources.map((r) => toRepoRelative(root, r.sourceUri.path.toString())) ?? [];
    if (paths.length === 0) return;
    await this.provider.unstage(paths);
  }

  private async commitWithPrompt(): Promise<void> {
    const message = await this.quickInput.input({
      prompt: "Commit message",
      placeHolder: "feat: describe your change",
      validateInput: (v) =>
        v.trim().length > 0
          ? Promise.resolve(undefined)
          : Promise.resolve("Commit message cannot be empty."),
    });
    if (!message) return;
    await this.runGitOp("Commit", () => this.provider.commit(message), "Changes committed.");
  }

  private async checkoutWithPrompt(): Promise<void> {
    const branches = await this.provider.getBranches();
    const items = branches
      .filter((b) => !b.isRemote)
      .map((b) => ({ label: b.name, description: b.isCurrent ? "(current)" : "" }));
    const picked = await this.quickInput.pick(items, { placeHolder: "Select branch to checkout" });
    if (!picked) return;
    await this.runGitOp(
      `Checkout ${picked.label}`,
      () => this.provider.checkout(picked.label),
      `Checked out branch: ${picked.label}`,
    );
  }

  private async createBranchWithPrompt(): Promise<void> {
    const name = await this.quickInput.input({
      prompt: "New branch name",
      placeHolder: "feat/my-feature",
      validateInput: (v) =>
        /^[a-zA-Z0-9_\-./]+$/.test(v.trim()) && v.trim().length > 0
          ? Promise.resolve(undefined)
          : Promise.resolve("Use alphanumeric characters, hyphens, underscores, dots, or slashes."),
    });
    if (!name) return;
    const branchName = name.trim();
    await this.runGitOp(
      `Create branch ${branchName}`,
      () => this.provider.createBranch(branchName, true),
      `Created and checked out branch: ${branchName}`,
    );
  }

  /**
   * Repository-relative paths for the SCM rows the command was invoked on.
   * The SCM tree spreads the selected resources as individual arguments
   * (see ActionMenuNode.run in @theia/core), not as a single array — so
   * this must accept the already-spread rest args, not `arg: unknown`.
   * Deduplicated because a file with both a staged and unstaged change is
   * two distinct rows sharing one repo-relative path.
   */
  private pathsOf(items: unknown[]): string[] {
    const root = this.provider.root;
    if (!root) return [];
    const paths = items
      .map((i) => (i as { sourceUri?: { path?: { toString(): string } } })?.sourceUri?.path?.toString())
      .filter((p): p is string => typeof p === "string")
      .map((p) => toRepoRelative(root, p));
    return [...new Set(paths)];
  }

  private async discardWithConfirm(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const listed = paths.length <= 5
      ? paths.join("\n")
      : `${paths.slice(0, 5).join("\n")}\n…and ${paths.length - 5} more`;
    const ok = await new ConfirmDialog({
      title: paths.length === 1 ? "Discard changes" : `Discard changes in ${paths.length} files`,
      msg: `${listed}\n\nChanges will be lost. This cannot be undone.`,
      ok: "Discard",
      cancel: "Cancel",
    }).open();
    if (!ok) return;
    await this.runGitOp("Discard changes", () => this.provider.discard(paths), "Changes discarded.");
  }

  /**
   * Runs a git operation behind an indeterminate progress bar shown at the top
   * of the SCM panel (the `scm` progress location wired by Theia's view
   * container) and reports the outcome: the optional success message on
   * completion, an error notification on failure. The progress is always
   * dismissed.
   */
  private async runGitOp(
    label: string,
    op: () => Promise<void>,
    successMessage?: string,
  ): Promise<void> {
    const progress = await this.progressService.showProgress({
      text: `${label}…`,
      options: { location: "scm" },
    });
    try {
      await op();
      if (successMessage) this.messages.info(successMessage);
    } catch (err) {
      await this.provider.showError(
        `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      progress.cancel();
    }
  }
}
