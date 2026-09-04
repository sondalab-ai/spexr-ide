export const GIT_SERVICE_PATH = "/services/spexr-git";

/**
 * `?` untracked · `U` unmerged (conflict) · the rest are git's own index
 * letters. These two were previously conflated: untracked was reported as `U`
 * while git's unmerged `U` was folded into `C`.
 */
export type GitFileState = "A" | "M" | "D" | "R" | "C" | "U" | "?";

/**
 * The seven unmerged index/worktree pairs of `git status --porcelain`. `U`
 * alone loses which side did what, and two of these — `UD` (deleted by them,
 * modified by us) and `DU` (deleted by us, modified by them) — have two
 * legitimate resolutions rather than one.
 */
export type GitConflictKind = "UU" | "AA" | "DD" | "AU" | "UA" | "DU" | "UD";

export interface GitFileChangeDto {
  readonly path: string;
  readonly originalPath?: string;
  readonly stagedState?: GitFileState;
  readonly unstagedState?: GitFileState;
  /** Set exactly when `unstagedState` is `"U"`: which kind of conflict it is. */
  readonly conflict?: GitConflictKind;
}

export interface GitStatusDto {
  readonly branch: string;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly files: readonly GitFileChangeDto[];
  readonly isClean: boolean;
  /**
   * A merge is started and not yet committed (`MERGE_HEAD` exists). Independent
   * of `files`: resolving a delete/modify conflict in favour of the deletion can
   * leave the status completely empty with the merge still open, so a clean tree
   * is not evidence that there is nothing to finish.
   *
   * Covers `git merge` only. A rebase or cherry-pick left mid-flight is not
   * reported here.
   */
  readonly mergeInProgress: boolean;
}

export interface GitBranchDto {
  readonly name: string;
  readonly isCurrent: boolean;
  readonly isRemote: boolean;
  readonly upstream?: string;
}

export interface GitLogEntryDto {
  readonly hash: string;
  readonly message: string;
  readonly author: string;
  readonly date: string;
}

/** A commit referenced by one or more blamed lines. */
export interface BlameCommitDto {
  readonly hash: string;
  readonly author: string;
  readonly authorMail: string;
  /** Author time, unix seconds. */
  readonly authorTime: number;
  readonly summary: string;
}

/** Maps a 1-based file line to the hash of the commit that last touched it. */
export interface BlameLineDto {
  readonly line: number;
  readonly hash: string;
}

/**
 * Blame for a whole file. Commits are deduplicated into `commits` (keyed by
 * full hash); `lines` references them by hash. Lines not yet committed carry
 * the all-zero hash, present in `commits` with empty author fields.
 */
export interface BlameResultDto {
  readonly commits: Record<string, BlameCommitDto>;
  readonly lines: readonly BlameLineDto[];
}

/** Push channel: backend → frontend. */
export interface SpexrGitClient {
  /** The repository changed on disk — from this IDE, a terminal, or anything else. */
  onRepositoryChanged(): void;
}

export interface SpexrGitService {
  /**
   * Registers the push channel. The repository watcher is armed lazily, per
   * root, on that root's first `getStatus` call — `setClient` itself has no
   * root to arm yet.
   */
  setClient(client: SpexrGitClient): void;
  /**
   * Absolute path of the repository's top-level working directory, or undefined
   * when `root` is not inside a repository. Stays on the same logical path
   * `root` was given on (symlinks are not resolved away), because callers match
   * it against workspace-folder paths.
   *
   * Every other method reports paths relative to this, not to `root` — a
   * workspace folder nested inside a repository must therefore be mapped here
   * before its status can be turned into file URIs. It also collapses two
   * workspace folders of the same repository onto one answer, which is what
   * lets a repository be listed once rather than once per folder.
   */
  resolveToplevel(root: string): Promise<string | undefined>;
  getStatus(root: string): Promise<GitStatusDto>;
  stage(root: string, paths: string[]): Promise<void>;
  unstage(root: string, paths: string[]): Promise<void>;
  /**
   * Throw away working-tree changes. For tracked paths, unstaged edits are
   * discarded and the file reverts to its staged (index) content — a staged
   * edit survives and the file stays staged. Untracked paths are deleted from
   * disk. Irreversible — callers confirm first.
   */
  discard(root: string, paths: string[]): Promise<void>;
  /**
   * `git rm` — removes the paths from the working tree and stages the removal.
   * On a delete/modify conflict this is the "accept the deletion" resolution,
   * the counterpart of staging the file to keep it.
   */
  removePath(root: string, paths: string[]): Promise<void>;
  commit(root: string, message: string): Promise<void>;
  /**
   * A Conventional Commits subject for what is currently staged, written by the
   * local model. The `type(scope):` prefix is composed from the staged paths; the
   * model contributes only the clause after it.
   *
   * `null` whenever no subject could be produced — nothing staged, no local model
   * (unavailable or crashed out), or a reply with nothing usable in it. Callers
   * distinguish "nothing staged" themselves, from the status they already hold.
   */
  generateCommitMessage(root: string): Promise<string | null>;
  getBranches(root: string): Promise<GitBranchDto[]>;
  checkout(root: string, branch: string): Promise<void>;
  createBranch(root: string, name: string, checkout: boolean): Promise<void>;
  /**
   * Push the current branch. The upstream decision belongs to the backend: a
   * branch with tracking pushes bare, one without gets `--set-upstream` against
   * the remote picked from the repository's own remotes.
   */
  push(root: string): Promise<void>;
  pull(root: string): Promise<void>;
  fetch(root: string): Promise<void>;
  getLog(root: string, maxCount?: number): Promise<GitLogEntryDto[]>;
  getFileAtRevision(root: string, filePath: string, rev: string): Promise<string>;
  getBlame(root: string, filePath: string): Promise<BlameResultDto>;
  /** Normalized https URL of the `origin` remote, or undefined if none. */
  getRemoteUrl(root: string): Promise<string | undefined>;
  /**
   * Workspace-relative paths ignored by git — honoring the repo `.gitignore`
   * (including nested ones), the global `core.excludesFile`, and `.git/info/exclude`.
   * Fully-ignored directories are collapsed to a single entry ending in `/`.
   */
  getIgnoredPaths(root: string): Promise<string[]>;
}
