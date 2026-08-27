export const GIT_SERVICE_PATH = "/services/spexr-git";

export type GitFileState = "A" | "M" | "D" | "R" | "U" | "C";

export interface GitFileChangeDto {
  readonly path: string;
  readonly originalPath?: string;
  readonly stagedState?: GitFileState;
  readonly unstagedState?: GitFileState;
}

export interface GitStatusDto {
  readonly branch: string;
  readonly upstream?: string;
  readonly ahead: number;
  readonly behind: number;
  readonly files: readonly GitFileChangeDto[];
  readonly isClean: boolean;
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
  getStatus(root: string): Promise<GitStatusDto>;
  stage(root: string, paths: string[]): Promise<void>;
  unstage(root: string, paths: string[]): Promise<void>;
  commit(root: string, message: string): Promise<void>;
  getDiff(root: string, filePath: string, staged: boolean): Promise<string>;
  getBranches(root: string): Promise<GitBranchDto[]>;
  checkout(root: string, branch: string): Promise<void>;
  createBranch(root: string, name: string, checkout: boolean): Promise<void>;
  push(root: string, remote?: string, branch?: string): Promise<void>;
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
