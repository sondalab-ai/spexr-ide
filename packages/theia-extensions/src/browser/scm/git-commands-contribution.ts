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
import type { SpexrGitScmProvider } from "./git-scm-provider.js";
import { SpexrGitScmRegistry } from "./git-scm-registry.js";
import { toRepoRelative } from "./relative-path.js";
import { explainCheckoutFailure } from "./checkout-failure.js";
import { commitBlockReason } from "./commit-preflight.js";
import { formatPullOutcome } from "./pull-outcome-format.js";
import { pushBlockReason } from "./push-preflight.js";
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
  COMMIT_AND_PUSH: {
    id: "spexr.git.commitAndPush",
    label: "Git: Commit Staged Changes and Push",
  } satisfies Command,
  GENERATE_MESSAGE: {
    id: "spexr.git.generateCommitMessage",
    label: "Git: Generate Commit Message",
  } satisfies Command,
  UNDO_LAST_COMMIT: {
    id: "spexr.git.undoLastCommit",
    label: "Git: Undo Last Commit",
  } satisfies Command,
  AMEND_COMMIT: { id: "spexr.git.amendCommit", label: "Git: Amend Last Commit" } satisfies Command,
  PUSH: { id: "spexr.git.push", label: "Git: Push" } satisfies Command,
  PULL: { id: "spexr.git.pull", label: "Git: Pull" } satisfies Command,
  FETCH: { id: "spexr.git.fetch", label: "Git: Fetch" } satisfies Command,
  STASH: { id: "spexr.git.stash", label: "Git: Stash Changes" } satisfies Command,
  STASH_POP: { id: "spexr.git.stashPop", label: "Git: Pop Stash" } satisfies Command,
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
  @inject(SpexrGitScmRegistry)
  private readonly registry!: SpexrGitScmRegistry;

  @inject(QuickInputService)
  private readonly quickInput!: QuickInputService;

  @inject(MessageService)
  private readonly messages!: MessageService;

  @inject(ProgressService)
  private readonly progressService!: ProgressService;

  /**
   * The repository these commands act on: the one the SCM panel is showing.
   * Theia's ScmWidget renders a single repository at a time behind its own
   * picker, so every row a command can be invoked on belongs to this provider.
   * Undefined outside a repository, where the commands become no-ops.
   */
  private get provider(): SpexrGitScmProvider | undefined {
    return this.registry.active;
  }

  /** Run `op` against the shown repository, or do nothing when there is none. */
  private async onProvider(op: (p: SpexrGitScmProvider) => Promise<void>): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    await op(provider);
  }

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
      execute: (message: unknown) => this.commit(typeof message === "string" ? message : ""),
    });
    commands.registerCommand(GitCommands.COMMIT_AND_PUSH, {
      execute: () => this.commitAndPush(),
    });
    commands.registerCommand(GitCommands.GENERATE_MESSAGE, {
      execute: () => this.generateCommitMessage(),
    });
    commands.registerCommand(GitCommands.UNDO_LAST_COMMIT, {
      execute: () => this.undoLastCommit(),
    });
    commands.registerCommand(GitCommands.AMEND_COMMIT, {
      execute: () => this.amendLastCommit(),
    });
    commands.registerCommand(GitCommands.PUSH, {
      execute: () => this.pushWithPreflight(),
    });
    commands.registerCommand(GitCommands.PULL, {
      execute: () => this.pull(),
    });
    commands.registerCommand(GitCommands.FETCH, {
      execute: () =>
        this.runGitOp("Fetch", () => this.onProvider((p) => p.fetch()), "Fetched from remote."),
    });
    commands.registerCommand(GitCommands.STASH, {
      execute: () => this.stashWithPrompt(),
    });
    commands.registerCommand(GitCommands.STASH_POP, {
      execute: () => this.stashPopWithPick(),
    });
    commands.registerCommand(GitCommands.CHECKOUT, {
      execute: () => this.checkoutWithPrompt(),
    });
    commands.registerCommand(GitCommands.CREATE_BRANCH, {
      execute: () => this.createBranchWithPrompt(),
    });
    commands.registerCommand(GitCommands.REFRESH, {
      execute: () => this.runGitOp("Refresh", () => this.onProvider((p) => p.refresh())),
    });
    commands.registerCommand(GitCommands.STAGE_FILE, {
      execute: (...args: unknown[]) =>
        this.runGitOp("Stage file", () => this.onProvider((p) => p.stage(this.pathsOf(args)))),
      isVisible: (...args: unknown[]) => allInGroup(args, "workingTree"),
    });
    commands.registerCommand(GitCommands.UNSTAGE_FILE, {
      execute: (...args: unknown[]) =>
        this.runGitOp("Unstage file", () => this.onProvider((p) => p.unstage(this.pathsOf(args)))),
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
          () => this.onProvider((p) => p.stage(this.pathsOf(args))),
          "Marked resolved.",
        ),
      // Not on a delete/modify row: there, staging is one of two legitimate
      // resolutions, and a button called "Mark Resolved" would silently pick
      // it. Those rows get Keep File / Accept Deletion instead.
      isVisible: (...args: unknown[]) => allSingleOutcomeConflicts(args),
    });
    commands.registerCommand(GitCommands.KEEP_FILE, {
      execute: (...args: unknown[]) =>
        this.runGitOp(
          "Keep file",
          () => this.onProvider((p) => p.stage(this.pathsOf(args))),
          "File kept.",
        ),
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
    await this.onProvider(async (provider) => {
      const paths = this.groupPaths(provider, "workingTree");
      if (paths.length === 0) return;
      await provider.stage(paths);
    });
  }

  private async unstageAll(): Promise<void> {
    await this.onProvider(async (provider) => {
      const paths = this.groupPaths(provider, "index");
      if (paths.length === 0) return;
      await provider.unstage(paths);
    });
  }

  /** Repository-relative paths of every row in one of the provider's groups. */
  private groupPaths(provider: SpexrGitScmProvider, groupId: string): string[] {
    const root = provider.root;
    if (!root) return [];
    return (
      provider.groups
        .find((g) => g.id === groupId)
        ?.resources.map((r) => toRepoRelative(root, r.sourceUri.path.toString())) ?? []
    );
  }

  /**
   * Commit what the message box already holds, and ask for a message only when it
   * is empty. Asking either way made the box — which the model now fills — a
   * message the user had to type again into a second prompt.
   *
   * The preflight runs before the prompt, not after: being asked for a message
   * and only then told there is nothing to commit wastes the typing.
   */
  private async commitWithPrompt(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    const blocked = await this.commitBlocked(provider);
    if (blocked) {
      this.messages.warn(blocked);
      return;
    }
    const message = provider.inputValue.trim() || (await this.promptForMessage());
    if (!message) return;
    await this.runCommit(provider, message);
  }

  /** The panel's own accept action (Ctrl/Cmd+Enter in the message box). */
  private async commit(message: string): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    const blocked = await this.commitBlocked(provider);
    if (blocked) {
      this.messages.warn(blocked);
      return;
    }
    await this.runCommit(provider, message);
  }

  /**
   * The whole gesture behind "I am done with this change": commit, then push.
   * Splitting it in two is what lets a commit be forgotten and a push be
   * pressed on an unchanged branch, which is the mistake this pair of
   * preflights otherwise only reports after the fact.
   *
   * The push runs its own preflight, so a commit that leaves nothing to send
   * (an amend already pushed, say) still reports honestly rather than pushing.
   */
  private async commitAndPush(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    const blocked = await this.commitBlocked(provider);
    if (blocked) {
      this.messages.warn(blocked);
      return;
    }
    const message = provider.inputValue.trim() || (await this.promptForMessage());
    if (!message) return;
    if (!(await this.runCommit(provider, message))) return;
    await this.pushWithPreflight();
  }

  /**
   * Refresh, then why a commit would fail — undefined when it would work. An
   * absent status means the refresh failed, and a push or commit the user is
   * entitled to must not be blocked on a guess, so that fails open too.
   */
  private async commitBlocked(provider: SpexrGitScmProvider): Promise<string | undefined> {
    await provider.refresh();
    const status = provider.lastStatus;
    return status ? commitBlockReason(status) : undefined;
  }

  private async promptForMessage(): Promise<string | undefined> {
    return this.quickInput.input({
      prompt: "Commit message",
      placeHolder: "feat: describe your change",
      validateInput: (v) =>
        v.trim().length > 0
          ? Promise.resolve(undefined)
          : Promise.resolve("Commit message cannot be empty."),
    });
  }

  /** Commit, then empty the box — on success only, so a failed commit keeps the text. */
  private async runCommit(provider: SpexrGitScmProvider, message: string): Promise<boolean> {
    return this.runGitOp(
      "Commit",
      async () => {
        await provider.commit(message);
        provider.setInputValue("");
      },
      "Changes committed.",
    );
  }

  /**
   * Push, unless the push would send nothing. A no-op push still succeeds, and
   * "Pushed to remote." on staged-but-uncommitted work reads as a lie — so the
   * refusal happens before runGitOp, where that toast cannot fire.
   *
   * Refreshes first: the decision is made on the status the panel holds, which
   * a background change may have left behind. A refresh that fails leaves the
   * status undefined and the push goes ahead — guessing wrong must not block a
   * push the user is entitled to.
   */
  private async pushWithPreflight(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    await provider.refresh();
    const status = provider.lastStatus;
    const reason = status && pushBlockReason(status);
    if (reason) {
      this.messages.warn(reason);
      return;
    }
    await this.runGitOp("Push", () => provider.push(), "Pushed to remote.");
  }

  /**
   * Drop the last commit and put its changes back in the index — the recovery
   * for a commit made too early, which otherwise needs a terminal.
   */
  private async undoLastCommit(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    await provider.refresh();
    const ok = await this.confirmHistoryRewrite(
      provider,
      "Undo last commit",
      "The commit is dropped and its changes go back to the staged area.",
    );
    if (!ok) return;
    await this.runGitOp(
      "Undo last commit",
      () => provider.undoLastCommit(),
      "Last commit undone — its changes are staged again.",
    );
  }

  /**
   * Fold what is staged into the last commit, replacing its message only when
   * the box holds one. An empty box keeps the original message whole rather
   * than rebuilding it from a subject, which would drop the body.
   */
  private async amendLastCommit(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    await provider.refresh();
    const typed = provider.inputValue.trim();
    const staged = provider.lastStatus?.files.some((f) => f.stagedState !== undefined) ?? false;
    if (!typed && !staged) {
      this.messages.warn(
        "Nothing to amend — stage a change, or write a message to replace the last one.",
      );
      return;
    }
    const ok = await this.confirmHistoryRewrite(
      provider,
      "Amend last commit",
      typed
        ? "The last commit's message is replaced, and anything staged is folded into it."
        : "The staged changes are folded into the last commit, keeping its message.",
    );
    if (!ok) return;
    const amended = await this.runGitOp(
      "Amend",
      () => provider.amendCommit(typed || undefined),
      "Last commit amended.",
    );
    if (amended && typed) provider.setInputValue("");
  }

  /**
   * Confirm rewriting a commit the remote already has. With an upstream and
   * nothing ahead, the commit about to be rewritten is the one the remote points
   * at: the branch will only push again by force, and anyone who pulled it
   * diverges. Ahead of the upstream, the commit is local and needs no ceremony.
   */
  private async confirmHistoryRewrite(
    provider: SpexrGitScmProvider,
    title: string,
    what: string,
  ): Promise<boolean> {
    const status = provider.lastStatus;
    if (!status?.upstream || status.ahead > 0) return true;
    const confirmed = await new ConfirmDialog({
      title,
      msg: `${what}\n\nThat commit is already on ${status.upstream}. Rewriting it means the branch can only be pushed by force, and anyone who has pulled it will diverge.`,
      ok: "Rewrite",
      cancel: "Cancel",
    }).open();
    return confirmed === true;
  }

  /**
   * Report what the pull brought rather than that it ran. The message is built
   * from the result, so it is shown here instead of through runGitOp's fixed
   * success text.
   */
  private async pull(): Promise<void> {
    await this.runGitOp("Pull", () =>
      this.onProvider(async (provider) => {
        this.messages.info(formatPullOutcome(await provider.pull()));
      }),
    );
  }

  /**
   * Set the working tree aside, untracked files included. The message is
   * optional — an empty one leaves git's own "WIP on <branch>" — because being
   * made to name a two-minute detour is what stops people from stashing.
   */
  private async stashWithPrompt(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    const message = await this.quickInput.input({
      prompt: "Stash message (optional)",
      placeHolder: "What you are setting aside",
    });
    // Undefined is Escape — a cancelled prompt, not an unnamed stash.
    if (message === undefined) return;
    await this.runGitOp("Stash", async () => {
      const stashed = await provider.stashPush(message.trim() || undefined);
      this.messages.info(
        stashed ? "Changes stashed." : "Nothing to stash — the working tree is clean.",
      );
    });
  }

  /**
   * Pop a chosen entry rather than always the newest: the stack outlives the
   * branch it was taken on, and the top of it is often not the one wanted.
   */
  private async stashPopWithPick(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    const entries = await provider.stashList();
    if (entries.length === 0) {
      this.messages.info("No stashes to pop.");
      return;
    }
    const picked = await this.quickInput.pick(
      entries.map((e) => ({ label: e.message, description: `stash@{${e.index}}` })),
      { placeHolder: "Select a stash to restore" },
    );
    if (!picked) return;
    const entry = entries.find((e) => `stash@{${e.index}}` === picked.description);
    if (!entry) return;
    await this.runGitOp(
      "Pop stash",
      () => provider.stashPop(entry.index),
      "Stash restored and dropped.",
    );
  }

  private async checkoutWithPrompt(): Promise<void> {
    const branches = (await this.provider?.getBranches()) ?? [];
    const items = branches
      .filter((b) => !b.isRemote)
      .map((b) => ({ label: b.name, description: b.isCurrent ? "(current)" : "" }));
    const picked = await this.quickInput.pick(items, { placeHolder: "Select branch to checkout" });
    if (!picked) return;
    await this.runGitOp(
      `Checkout ${picked.label}`,
      () => this.onProvider((p) => p.checkout(picked.label)),
      `Checked out branch: ${picked.label}`,
      explainCheckoutFailure,
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
      () => this.onProvider((p) => p.createBranch(branchName, true)),
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
    const root = this.provider?.root;
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
      () => this.onProvider((p) => p.discard(paths)),
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
      () => this.onProvider((p) => p.removePath(paths)),
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
    const provider = this.provider;
    if (!provider) return;
    const staged = provider.lastStatus?.files.filter((f) => f.stagedState !== undefined) ?? [];
    if (staged.length === 0) {
      this.messages.info("Nothing staged — stage the changes you want described first.");
      return;
    }
    if (provider.inputValue.trim().length > 0) {
      this.messages.info("The commit message box already has text — clear it to generate a new message.");
      return;
    }
    await this.runGitOp("Generate commit message", async () => {
      const message = await provider.generateCommitMessage();
      if (!message) {
        this.messages.info("The local model could not write a commit message.");
        return;
      }
      // Never drop a message the model spent real time on: if the box is gone,
      // say so and hand the text over rather than discarding it silently.
      if (!provider.setInputValue(message)) this.messages.info(`Suggested message: ${message}`);
    });
  }

  /**
   * True when `op` completed. Returned rather than thrown because the errors are
   * already reported here — a caller that chains two operations needs to know
   * not to start the second one, and Commit & Push must not push after a commit
   * that failed.
   *
   * `explainError` gets first refusal on the failure text, for operations whose
   * git message states the problem in terms the user cannot act on.
   */
  private async runGitOp(
    label: string,
    op: () => Promise<void>,
    successMessage?: string,
    explainError?: (message: string) => string | undefined,
  ): Promise<boolean> {
    const progress = await this.progressService.showProgress({
      text: `${label}…`,
      options: { location: "scm" },
    });
    try {
      await op();
      if (successMessage) this.messages.info(successMessage);
      return true;
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      this.messages.error(explainError?.(raw) ?? `${label} failed: ${raw}`);
      return false;
    } finally {
      progress.cancel();
    }
  }
}
