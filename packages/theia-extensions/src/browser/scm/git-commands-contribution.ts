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
import {
  allDeleteModifyConflicts,
  allInGroup,
  allSingleOutcomeConflicts,
  isResourceGroup,
  resourcePaths,
} from "./scm-resource-args.js";

export const GitCommands = {
  STAGE_ALL: { id: "spexr.git.stageAll", label: "Git: Stage All Changes" } satisfies Command,
  UNSTAGE_ALL: { id: "spexr.git.unstageAll", label: "Git: Unstage All Changes" } satisfies Command,
  COMMIT: { id: "spexr.git.commit", label: "Git: Commit Staged Changes" } satisfies Command,
  COMMIT_FROM_PANEL: { id: "spexr.git.commitFromPanel", label: "Commit" } satisfies Command,
  GENERATE_MESSAGE: {
    id: "spexr.git.generateCommitMessage",
    label: "Git: Generate Commit Message",
  } satisfies Command,
  PUSH: { id: "spexr.git.push", label: "Git: Push" } satisfies Command,
  PULL: { id: "spexr.git.pull", label: "Git: Pull" } satisfies Command,
  FETCH: { id: "spexr.git.fetch", label: "Git: Fetch" } satisfies Command,
  CHECKOUT: { id: "spexr.git.checkout", label: "Git: Checkout Branch" } satisfies Command,
  CREATE_BRANCH: { id: "spexr.git.createBranch", label: "Git: Create Branch" } satisfies Command,
  REFRESH: { id: "spexr.git.refresh", label: "Git: Refresh" } satisfies Command,
  STAGE_FILE: { id: "spexr.git.stageFile", label: "Git: Stage File" } satisfies Command,
  UNSTAGE_FILE: { id: "spexr.git.unstageFile", label: "Git: Unstage File" } satisfies Command,
  DISCARD_FILE: {
    id: "spexr.git.discardFile",
    label: "Git: Discard File Changes",
  } satisfies Command,
  MARK_RESOLVED: {
    id: "spexr.git.markResolved",
    label: "Git: Mark Conflict Resolved",
  } satisfies Command,
  KEEP_FILE: {
    id: "spexr.git.keepFile",
    label: "Git: Resolve Conflict Keeping the File",
  } satisfies Command,
  ACCEPT_DELETION: {
    id: "spexr.git.acceptDeletion",
    label: "Git: Resolve Conflict Accepting the Deletion",
  } satisfies Command,
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
      // Restricts the group-header button to the Changes group without
      // hiding the command from the command palette (which calls isVisible
      // with no args at all — see isResourceGroup).
      isVisible: (...args: unknown[]) => isResourceGroup(args, "workingTree"),
    });
    commands.registerCommand(GitCommands.UNSTAGE_ALL, {
      execute: () => this.runGitOp("Unstage changes", () => this.unstageAll()),
      isVisible: (...args: unknown[]) => isResourceGroup(args, "index"),
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
    commands.registerCommand(GitCommands.GENERATE_MESSAGE, {
      execute: () => this.generateCommitMessage(),
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
      isVisible: (...args: unknown[]) => allInGroup(args, "workingTree"),
    });
    commands.registerCommand(GitCommands.UNSTAGE_FILE, {
      execute: (...args: unknown[]) =>
        this.runGitOp("Unstage file", () => this.provider.unstage(this.pathsOf(args))),
      isVisible: (...args: unknown[]) => allInGroup(args, "index"),
    });
    commands.registerCommand(GitCommands.DISCARD_FILE, {
      execute: (...args: unknown[]) => this.discardWithConfirm(this.pathsOf(args)),
      // Never on a Staged Changes row: a file with both a staged edit and a
      // further unstaged edit is two rows sharing one repo-relative path, and
      // discarding from the staged row would silently destroy the unstaged
      // edit the user did not click on.
      isVisible: (...args: unknown[]) => allInGroup(args, "workingTree"),
    });
    commands.registerCommand(GitCommands.MARK_RESOLVED, {
      execute: (...args: unknown[]) =>
        // Staging IS resolution, in git's own terms.
        this.runGitOp(
          "Mark resolved",
          () => this.provider.stage(this.pathsOf(args)),
          "Marked resolved.",
        ),
      // Not on a delete/modify row: there, staging is one of two legitimate
      // resolutions, and a button called "Mark Resolved" would silently pick
      // it. Those rows get Keep File / Accept Deletion instead.
      isVisible: (...args: unknown[]) => allSingleOutcomeConflicts(args),
    });
    commands.registerCommand(GitCommands.KEEP_FILE, {
      execute: (...args: unknown[]) =>
        this.runGitOp("Keep file", () => this.provider.stage(this.pathsOf(args)), "File kept."),
      isVisible: (...args: unknown[]) => allDeleteModifyConflicts(args),
    });
    commands.registerCommand(GitCommands.ACCEPT_DELETION, {
      execute: (...args: unknown[]) => this.acceptDeletionWithConfirm(this.pathsOf(args)),
      isVisible: (...args: unknown[]) => allDeleteModifyConflicts(args),
    });
  }

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_GROUP_INLINE_MENU, {
      commandId: GitCommands.STAGE_ALL.id,
      label: "Stage All Changes",
      icon: "codicon codicon-add",
      order: "1",
    });
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_GROUP_INLINE_MENU, {
      commandId: GitCommands.UNSTAGE_ALL.id,
      label: "Unstage All Changes",
      icon: "codicon codicon-remove",
      order: "1",
    });
    for (const cmd of [GitCommands.STAGE_ALL, GitCommands.UNSTAGE_ALL]) {
      menus.registerMenuAction(ScmTreeWidget.RESOURCE_GROUP_CONTEXT_MENU, {
        commandId: cmd.id,
        label: cmd.label,
      });
    }

    menus.registerMenuAction(ScmTreeWidget.RESOURCE_INLINE_MENU, {
      commandId: GitCommands.STAGE_FILE.id,
      label: "Stage",
      icon: "codicon codicon-add",
      order: "1",
    });
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_INLINE_MENU, {
      commandId: GitCommands.UNSTAGE_FILE.id,
      label: "Unstage",
      icon: "codicon codicon-remove",
      order: "2",
    });
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_INLINE_MENU, {
      commandId: GitCommands.DISCARD_FILE.id,
      label: "Discard",
      icon: "codicon codicon-discard",
      order: "3",
    });
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_INLINE_MENU, {
      commandId: GitCommands.MARK_RESOLVED.id,
      label: "Mark Resolved",
      icon: "codicon codicon-check",
      order: "4",
    });
    // Mutually exclusive with Mark Resolved above — a conflict row shows
    // either that one button or these two, never both.
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_INLINE_MENU, {
      commandId: GitCommands.KEEP_FILE.id,
      label: "Keep File",
      icon: "codicon codicon-check",
      order: "4",
    });
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_INLINE_MENU, {
      commandId: GitCommands.ACCEPT_DELETION.id,
      label: "Accept Deletion",
      icon: "codicon codicon-trash",
      order: "5",
    });
    for (const cmd of [
      GitCommands.STAGE_FILE,
      GitCommands.UNSTAGE_FILE,
      GitCommands.DISCARD_FILE,
      GitCommands.MARK_RESOLVED,
      GitCommands.KEEP_FILE,
      GitCommands.ACCEPT_DELETION,
    ]) {
      menus.registerMenuAction(ScmTreeWidget.RESOURCE_CONTEXT_MENU, {
        commandId: cmd.id,
        label: cmd.label,
      });
    }
  }

  private async stageAll(): Promise<void> {
    const root = this.provider.root;
    if (!root) return;
    const paths =
      this.provider.groups
        .find((g) => g.id === "workingTree")
        ?.resources.map((r) => toRepoRelative(root, r.sourceUri.path.toString())) ?? [];
    if (paths.length === 0) return;
    await this.provider.stage(paths);
  }

  private async unstageAll(): Promise<void> {
    const root = this.provider.root;
    if (!root) return;
    const paths =
      this.provider.groups
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
   */
  private pathsOf(items: unknown[]): string[] {
    const root = this.provider.root;
    if (!root) return [];
    return resourcePaths(root, items);
  }

  private async discardWithConfirm(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const listed =
      paths.length <= 5
        ? paths.join("\n")
        : `${paths.slice(0, 5).join("\n")}\n…and ${paths.length - 5} more`;
    const ok = await new ConfirmDialog({
      title: paths.length === 1 ? "Discard changes" : `Discard changes in ${paths.length} files`,
      msg: `${listed}\n\nUntracked files will be deleted. Other changes will revert to their staged content. This cannot be undone.`,
      ok: "Discard",
      cancel: "Cancel",
    }).open();
    if (!ok) return;
    await this.runGitOp(
      "Discard changes",
      () => this.provider.discard(paths),
      "Changes discarded.",
    );
  }

  /**
   * Accepting a deletion removes the file from the working tree, so it is
   * confirmed like a discard. Unlike a discard it is recoverable — the content
   * is still in HEAD or MERGE_HEAD — which the copy says rather than borrowing
   * discard's "cannot be undone".
   */
  private async acceptDeletionWithConfirm(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const listed =
      paths.length <= 5
        ? paths.join("\n")
        : `${paths.slice(0, 5).join("\n")}\n…and ${paths.length - 5} more`;
    const ok = await new ConfirmDialog({
      title: paths.length === 1 ? "Accept deletion" : `Accept deletion of ${paths.length} files`,
      msg: `${listed}\n\nThe file will be deleted from the working tree and the deletion staged. Its content stays reachable in the merge until you commit.`,
      ok: "Accept Deletion",
      cancel: "Cancel",
    }).open();
    if (!ok) return;
    await this.runGitOp(
      "Accept deletion",
      () => this.provider.removePath(paths),
      "Deletion accepted.",
    );
  }

  /**
   * Runs a git operation behind an indeterminate progress bar shown at the top
   * of the SCM panel (the `scm` progress location wired by Theia's view
   * container) and reports the outcome: the optional success message on
   * completion, an error notification on failure. The progress is always
   * dismissed.
   */
  /**
   * Fill the commit-message box from the local model. Refuses rather than guesses
   * in the two cases where generating would be wrong: nothing staged (there is no
   * change to describe) and a box the user has already typed in (their text wins).
   * The single model worker is shared with the Darkfactory summaries, so this can
   * queue behind one and take a while.
   */
  private async generateCommitMessage(): Promise<void> {
    const staged = this.provider.lastStatus?.files.filter((f) => f.stagedState !== undefined) ?? [];
    if (staged.length === 0) {
      this.messages.info("Nothing staged — stage the changes you want described first.");
      return;
    }
    if (this.provider.inputValue.trim().length > 0) {
      this.messages.info("The commit message box already has text — clear it to generate a new message.");
      return;
    }
    await this.runGitOp("Generate commit message", async () => {
      const message = await this.provider.generateCommitMessage();
      if (!message) {
        this.messages.info("The local model could not write a commit message.");
        return;
      }
      // Never drop a message the model spent real time on: if the box is gone,
      // say so and hand the text over rather than discarding it silently.
      if (!this.provider.setInputValue(message)) this.messages.info(`Suggested message: ${message}`);
    });
  }

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
