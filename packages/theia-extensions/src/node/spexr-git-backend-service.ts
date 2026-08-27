import { injectable, unmanaged } from "@theia/core/shared/inversify";
import { isAbsolute, resolve as resolvePath, join } from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { rm } from "node:fs/promises";
import simpleGit, { type SimpleGit } from "simple-git";
import type {
  SpexrGitService,
  SpexrGitClient,
  GitStatusDto,
  GitFileChangeDto,
  GitFileState,
  GitBranchDto,
  GitLogEntryDto,
  BlameResultDto,
  BlameCommitDto,
  BlameLineDto,
} from "../common/git-protocol.js";

const BLAME_HEADER = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/;

/** Coalesce a burst of git-dir writes (one operation touches several files). */
const WATCH_DEBOUNCE_MS = 150;

export interface GitBackendDeps {
  /** Directory-watch seam (default: node:fs `watch`); tests capture the calls. */
  watchDir?: (dir: string, recursive: boolean, onChange: () => void) => FSWatcher;
}

/**
 * Parse `git blame --line-porcelain` output into a {@link BlameResultDto}.
 *
 * In `--line-porcelain` mode every blamed line emits a full header block:
 * a `<40-hash> <orig> <final> [<n>]` line, repeated `author`/`summary`/…
 * fields, then a `\t`-prefixed line carrying the source content. We key
 * commits by hash so author/date/summary are stored once.
 */
export function parseBlamePorcelain(raw: string): BlameResultDto {
  const commits: Record<string, BlameCommitDto> = {};
  const lines: BlameLineDto[] = [];

  let hash = "";
  let finalLine = 0;
  let author = "";
  let authorMail = "";
  let authorTime = 0;
  let summary = "";

  for (const text of raw.split("\n")) {
    const header = BLAME_HEADER.exec(text);
    if (header) {
      // Capture groups are guaranteed present when the pattern matches.
      hash = header[1]!;
      finalLine = Number(header[2]);
      // Reset per-block fields; for repeated commits git omits some, but
      // --line-porcelain repeats them, so any stale value is overwritten below.
      author = authorMail = summary = "";
      authorTime = 0;
      continue;
    }
    if (text.startsWith("author ")) {
      author = text.slice("author ".length);
    } else if (text.startsWith("author-mail ")) {
      authorMail = text.slice("author-mail ".length).replace(/^<|>$/g, "");
    } else if (text.startsWith("author-time ")) {
      authorTime = Number(text.slice("author-time ".length));
    } else if (text.startsWith("summary ")) {
      summary = text.slice("summary ".length);
    } else if (text.startsWith("\t")) {
      // Content line: closes the current block.
      if (!commits[hash]) {
        commits[hash] = { hash, author, authorMail, authorTime, summary };
      }
      lines.push({ line: finalLine, hash });
    }
  }

  return { commits, lines };
}

function mapStateChar(char: string): GitFileState | undefined {
  switch (char) {
    case "A": return "A";
    case "M": return "M";
    case "D": return "D";
    case "R": return "R";
    case "C": return "C";
    case "U": return "C"; // merge conflict → treat as conflicted
    default: return undefined;
  }
}

function mapFileChange(
  filePath: string,
  indexChar: string,
  workingDirChar: string,
): GitFileChangeDto | undefined {
  if (indexChar === "?" && workingDirChar === "?") {
    return { path: filePath, unstagedState: "U" };
  }
  const stagedState =
    indexChar !== " " && indexChar !== "?" ? mapStateChar(indexChar) : undefined;
  const unstagedState =
    workingDirChar !== " " && workingDirChar !== "?" ? mapStateChar(workingDirChar) : undefined;
  if (!stagedState && !unstagedState) return undefined;
  return {
    path: filePath,
    ...(stagedState !== undefined && { stagedState }),
    ...(unstagedState !== undefined && { unstagedState }),
  };
}

/**
 * Normalize a git remote URL to its https web base (no trailing `.git`).
 * Handles scp-like (`git@host:org/repo.git`), `ssh://`, `git://` and https.
 * Returns undefined for anything that doesn't resolve to http(s).
 */
export function normalizeRemoteUrl(raw: string): string | undefined {
  let s = raw.trim();
  if (!s) return undefined;
  const scp = /^[^@/]+@([^:/]+):(.+)$/.exec(s);
  if (scp) {
    s = `https://${scp[1]}/${scp[2]}`;
  } else {
    s = s.replace(/^ssh:\/\/(?:[^@/]+@)?/, "https://").replace(/^git:\/\//, "https://");
  }
  s = s.replace(/\.git$/, "").replace(/\/+$/, "");
  return /^https?:\/\//.test(s) ? s : undefined;
}

/** Split NUL-separated `git ls-files -z` output into non-empty paths. */
export function parseIgnoredPaths(raw: string): string[] {
  return raw.split("\0").filter((p) => p.length > 0);
}

@injectable()
export class SpexrGitBackendService implements SpexrGitService {
  /**
   * One SimpleGit per repository root. `maxConcurrentProcesses: 1` makes
   * simple-git's own scheduler serialize every task for that repo, which is
   * why no hand-written queue is needed — constructing a fresh instance per
   * call (as this service used to) defeated that scheduler entirely.
   */
  private readonly clients = new Map<string, SimpleGit>();

  private readonly watchDir: (dir: string, recursive: boolean, onChange: () => void) => FSWatcher;
  private client?: SpexrGitClient;
  private readonly watchers: FSWatcher[] = [];
  /** Roots with at least one watch actually established — not stacked on repeat getStatus calls. */
  private readonly armed = new Set<string>();
  /** Roots confirmed not to be a repository, so getStatus stops re-running rev-parse on them. */
  private readonly notARepo = new Set<string>();
  private debounce?: ReturnType<typeof setTimeout>;

  constructor(@unmanaged() deps: GitBackendDeps = {}) {
    this.watchDir =
      deps.watchDir ?? ((dir, recursive, onChange) => watch(dir, { recursive }, onChange));
  }

  setClient(client: SpexrGitClient): void {
    this.client = client;
  }

  private git(root: string): SimpleGit {
    let client = this.clients.get(root);
    if (!client) {
      client = simpleGit(root, { maxConcurrentProcesses: 1 });
      this.clients.set(root, client);
    }
    return client;
  }

  /**
   * Resolves both git directories with a single `rev-parse` process: the
   * repository's own git dir and its COMMON git dir (identical outside a
   * linked worktree). Two separate `rev-parse` calls would queue rather than
   * run in parallel — `maxConcurrentProcesses: 1` in {@link git} serializes
   * every call for a root — so this is also strictly faster than resolving
   * them one at a time.
   */
  private async resolveGitDirs(root: string): Promise<{ gitDir: string; commonDir: string } | undefined> {
    try {
      const out = (await this.git(root).raw(["rev-parse", "--git-dir", "--git-common-dir"])).trim();
      const [gitDirRaw, commonDirRaw] = out.split("\n");
      if (!gitDirRaw) return undefined;
      const gitDir = isAbsolute(gitDirRaw) ? gitDirRaw : resolvePath(root, gitDirRaw);
      const commonDir = !commonDirRaw
        ? gitDir
        : isAbsolute(commonDirRaw)
          ? commonDirRaw
          : resolvePath(root, commonDirRaw);
      return { gitDir, commonDir };
    } catch {
      return undefined; // not a repository
    }
  }

  /**
   * Absolute path of the repository's git directory.
   *
   * Must not be derived as `root + "/.git"`: in a linked worktree `.git` is a
   * FILE holding a `gitdir:` pointer, so assuming a directory there yields a
   * path that never emits watch events. `rev-parse --git-dir` answers
   * correctly for plain repos, worktrees, and submodules alike.
   */
  async resolveGitDir(root: string): Promise<string | undefined> {
    return (await this.resolveGitDirs(root))?.gitDir;
  }

  /**
   * Absolute path of the repository's COMMON git directory — shared by every
   * linked worktree. Branch refs live here; a worktree's own `refs/` is empty,
   * so watching that instead would never see a branch move.
   */
  async resolveGitCommonDir(root: string): Promise<string | undefined> {
    return (await this.resolveGitDirs(root))?.commonDir;
  }

  /**
   * Watch the git dir so operations that touch only `.git` — commit, fetch,
   * branch create, and `git add` from a terminal — reach the panel. Theia's
   * file watcher excludes `.git` by default, so without this the panel only
   * ever sees its own writes.
   *
   * `root` is marked armed only once a watch is actually established: if
   * every attempt throws (permissions blip, path not yet created), the
   * failure must stay retryable on the next `getStatus` rather than
   * permanently muting the root.
   */
  private armWatch(root: string, gitDir: string, commonDir: string): void {
    const notify = (): void => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.client?.onRepositoryChanged(), WATCH_DEBOUNCE_MS);
    };
    // HEAD / index / MERGE_HEAD / ORIG_HEAD are per-worktree and live in gitDir.
    // Branch refs are shared, so they come from the common dir — in a linked
    // worktree gitDir/refs exists but is empty.
    const targets: readonly (readonly [string, boolean])[] = [
      [gitDir, false],
      [join(commonDir, "refs"), true],
    ];
    let established = false;
    for (const [dir, recursive] of targets) {
      try {
        this.watchers.push(this.watchDir(dir, recursive, () => { notify(); }));
        established = true;
      } catch {
        // Unwatchable path or permission error: degrade to the previous
        // behavior rather than failing the whole service.
      }
    }
    if (established) this.armed.add(root);
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    for (const w of this.watchers) {
      try { w.close(); } catch { /* already closed */ }
    }
    this.watchers.length = 0;
    this.armed.clear();
    this.notARepo.clear();
  }

  async getStatus(root: string): Promise<GitStatusDto> {
    if (this.client && !this.armed.has(root) && !this.notARepo.has(root)) {
      const dirs = await this.resolveGitDirs(root);
      if (dirs) {
        this.armWatch(root, dirs.gitDir, dirs.commonDir);
      } else {
        this.notARepo.add(root);
      }
    }
    const git = this.git(root);
    const status = await git.status();
    const files: GitFileChangeDto[] = status.files
      .map((f) => mapFileChange(f.path, f.index, f.working_dir))
      .filter((f): f is GitFileChangeDto => f !== undefined);
    return {
      branch: status.current ?? "unknown",
      ...(status.tracking && { upstream: status.tracking }),
      ahead: status.ahead,
      behind: status.behind,
      files,
      isClean: status.isClean(),
    };
  }

  async stage(root: string, paths: string[]): Promise<void> {
    await this.git(root).add(paths);
  }

  async unstage(root: string, paths: string[]): Promise<void> {
    const git = this.git(root);
    // On a virgin repo (no commits yet) HEAD doesn't exist; git reset HEAD fails.
    // Use git rm --cached instead, which is the correct unstage for that state.
    const hasHead = await git.raw(["rev-parse", "--verify", "HEAD"]).then(() => true).catch(() => false);
    if (hasHead) {
      await git.reset(["HEAD", "--", ...paths]);
    } else {
      await git.raw(["rm", "--cached", "--", ...paths]);
    }
  }

  async discard(root: string, paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const status = await this.git(root).status();
    const untracked = new Set(status.not_added);
    const toDelete = paths.filter((p) => untracked.has(p));
    const toRestore = paths.filter((p) => !untracked.has(p));

    if (toRestore.length > 0) {
      await this.git(root).checkout(["--", ...toRestore]);
    }
    for (const p of toDelete) {
      await rm(resolvePath(root, p), { force: true });
    }
  }

  async commit(root: string, message: string): Promise<void> {
    await this.git(root).commit(message);
  }

  async getDiff(root: string, filePath: string, staged: boolean): Promise<string> {
    return staged
      ? this.git(root).diff(["--cached", "--", filePath])
      : this.git(root).diff(["--", filePath]);
  }

  async getBranches(root: string): Promise<GitBranchDto[]> {
    const result = await this.git(root).branch(["-a", "-vv"]);
    return Object.values(result.branches).map((b) => ({
      name: b.name,
      isCurrent: b.current,
      isRemote: b.name.startsWith("remotes/"),
    }));
  }

  async checkout(root: string, branch: string): Promise<void> {
    await this.git(root).checkout(branch);
  }

  async createBranch(root: string, name: string, checkoutAfter: boolean): Promise<void> {
    if (checkoutAfter) {
      await this.git(root).checkoutLocalBranch(name);
    } else {
      await this.git(root).branch([name]);
    }
  }

  async push(root: string, remote?: string, branch?: string): Promise<void> {
    const git = this.git(root);
    if (remote && branch) {
      await git.push(remote, branch);
    } else {
      await git.push();
    }
  }

  async pull(root: string): Promise<void> {
    await this.git(root).pull();
  }

  async fetch(root: string): Promise<void> {
    await this.git(root).fetch();
  }

  async getLog(root: string, maxCount = 20): Promise<GitLogEntryDto[]> {
    const log = await this.git(root).log({ maxCount });
    return log.all.map((c) => ({
      hash: c.hash.slice(0, 7),
      message: c.message,
      author: c.author_name,
      date: c.date,
    }));
  }

  async getFileAtRevision(root: string, filePath: string, rev: string): Promise<string> {
    if (!/^(HEAD|:0|[0-9a-f]{7,40})$/.test(rev)) {
      throw new Error(`Invalid git revision: "${rev}"`);
    }
    if (filePath.startsWith("-") || filePath.includes("..")) {
      throw new Error(`Invalid file path: "${filePath}"`);
    }
    return this.git(root).show([`${rev}:${filePath}`]);
  }

  async getBlame(root: string, filePath: string): Promise<BlameResultDto> {
    if (filePath.startsWith("-") || filePath.includes("..")) {
      throw new Error(`Invalid file path: "${filePath}"`);
    }
    const raw = await this.git(root).raw([
      "blame",
      "--line-porcelain",
      "--",
      filePath,
    ]);
    return parseBlamePorcelain(raw);
  }

  async getIgnoredPaths(root: string): Promise<string[]> {
    try {
      // -o others (untracked), -i ignored, --exclude-standard honors repo + nested
      // .gitignore, the global core.excludesFile, and .git/info/exclude; --directory
      // collapses a fully-ignored dir to one entry; -z NUL-separates for safe paths.
      const raw = await this.git(root).raw([
        "ls-files", "-o", "-i", "--exclude-standard", "--directory", "-z",
      ]);
      return parseIgnoredPaths(raw);
    } catch {
      return []; // not a git repo → nothing ignored
    }
  }

  async getRemoteUrl(root: string): Promise<string | undefined> {
    try {
      const remotes = await this.git(root).getRemotes(true);
      const origin = remotes.find((r) => r.name === "origin") ?? remotes[0];
      const url = origin?.refs?.fetch;
      return url ? normalizeRemoteUrl(url) : undefined;
    } catch {
      return undefined;
    }
  }
}
