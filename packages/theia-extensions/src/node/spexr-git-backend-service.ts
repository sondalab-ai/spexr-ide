import { injectable, unmanaged } from "@theia/core/shared/inversify";
import { isAbsolute, resolve as resolvePath, join } from "node:path";
import { statSync, watch, type FSWatcher } from "node:fs";
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
    case "A":
      return "A";
    case "M":
      return "M";
    case "D":
      return "D";
    case "R":
      return "R";
    case "C":
      return "C";
    default:
      return undefined;
  }
}

/**
 * Index/worktree pairs git uses for an unmerged path — see `git help status`,
 * the "unmerged" section of the short-format table. Neither column can carry
 * these codes for a non-conflicted file: `U` only ever appears here, and `A`
 * never appears in the worktree column outside a conflict.
 */
const CONFLICT_PAIRS = new Set(["UU", "AA", "DD", "AU", "UA", "DU", "UD"]);

/**
 * Identity of a directory, not merely its path: its inode.
 *
 * A `.git` deleted and recreated in place keeps its path, so comparing paths
 * cannot tell the new directory from the old one — and the watchers armed on
 * the old one are dead. The inode survives writes inside the directory, which
 * timestamps do not: `ctime` changes every time git adds or removes an entry,
 * and `birthtime` degrades to `ctime` on filesystems without creation times.
 *
 * The trade-off is deliberate. A reused inode (or a filesystem that reports
 * `0` for every file) means a recreated git dir goes undetected — today's
 * behaviour — whereas a volatile identity would disarm and re-arm on every
 * call, leaking watchers. Missing the rare case beats that.
 *
 * Returns undefined when the directory is gone.
 */
export function dirIdentity(dir: string): string | undefined {
  try {
    return String(statSync(dir).ino);
  } catch {
    return undefined;
  }
}

export function mapFileChange(
  filePath: string,
  indexChar: string,
  workingDirChar: string,
): GitFileChangeDto | undefined {
  if (CONFLICT_PAIRS.has(`${indexChar}${workingDirChar}`)) {
    return { path: filePath, unstagedState: "U" };
  }
  if (indexChar === "?" && workingDirChar === "?") {
    return { path: filePath, unstagedState: "?" };
  }
  const stagedState = indexChar !== " " && indexChar !== "?" ? mapStateChar(indexChar) : undefined;
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

/**
 * The remote to push to when the caller did not name one. `origin` wins by
 * convention; a single remote under another name is unambiguous; anything
 * else is a real choice the user has to make, so say so rather than guess.
 */
export function pickRemote(remotes: string[]): string {
  if (remotes.includes("origin")) return "origin";
  if (remotes.length === 1) return remotes[0]!;
  if (remotes.length === 0) throw new Error("This repository has no remote configured.");
  throw new Error(
    `Several remotes and no "origin" — push explicitly to one of: ${remotes.join(", ")}.`,
  );
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
  /**
   * Roots with at least one watch actually established, keyed so a stale set
   * can be closed and re-armed. The git dir is kept alongside the watchers
   * because that is what goes stale: a `.git` deleted and recreated inside one
   * session leaves watchers that will never fire again.
   */
  private readonly armed = new Map<
    string,
    { gitDir: string; gitDirId: string; watchers: FSWatcher[] }
  >();
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
  private async resolveGitDirs(
    root: string,
  ): Promise<{ gitDir: string; commonDir: string } | undefined> {
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
    const watchers: FSWatcher[] = [];
    for (const [dir, recursive] of targets) {
      try {
        const watcher = this.watchDir(dir, recursive, () => {
          notify();
        });
        // A watcher that fails after being established is dead but still
        // bookkept, so without this the root would never re-arm. It also keeps
        // the event handled: an unhandled `error` on an EventEmitter throws.
        watcher.on("error", () => {
          this.disarm(root);
        });
        watchers.push(watcher);
      } catch {
        // Unwatchable path or permission error: degrade to the previous
        // behavior rather than failing the whole service.
      }
    }
    const gitDirId = watchers.length > 0 ? dirIdentity(gitDir) : undefined;
    if (gitDirId === undefined) {
      // Nothing established, or the git dir vanished mid-arm: close whatever
      // was opened and leave the root unarmed so the next call retries.
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* already closed */
        }
      }
      return;
    }
    this.armed.set(root, { gitDir, gitDirId, watchers });
  }

  /** Close and forget a root's watchers so the next getStatus arms fresh ones. */
  private disarm(root: string): void {
    const entry = this.armed.get(root);
    if (!entry) return;
    this.armed.delete(root);
    for (const w of entry.watchers) {
      try {
        w.close();
      } catch {
        /* already closed */
      }
    }
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    for (const root of [...this.armed.keys()]) this.disarm(root);
  }

  async getStatus(root: string): Promise<GitStatusDto> {
    if (this.client) {
      // fs.watch does not report the removal of the directory it watches on
      // every platform, so staleness is checked explicitly rather than left to
      // the error handler: a `.git` deleted and recreated in place is a new
      // directory at the same path, and the watchers on the old one are dead. A root that is not a repository is simply left
      // unarmed and re-probed: caching that answer costs one `rev-parse` on a
      // call that goes on to fail anyway, and permanently blinds the root to a
      // later `git init`.
      const entry = this.armed.get(root);
      if (entry && dirIdentity(entry.gitDir) !== entry.gitDirId) this.disarm(root);
      if (!this.armed.has(root)) {
        const dirs = await this.resolveGitDirs(root);
        if (dirs) this.armWatch(root, dirs.gitDir, dirs.commonDir);
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
    // `git reset HEAD --` with no paths is a full mixed reset — it empties
    // the entire index, unlike `git add` with no paths, which is a no-op.
    // stage/unstage must stay symmetric no-ops on an empty list.
    if (paths.length === 0) return;
    const git = this.git(root);
    // On a virgin repo (no commits yet) HEAD doesn't exist; git reset HEAD fails.
    // Use git rm --cached instead, which is the correct unstage for that state.
    const hasHead = await git
      .raw(["rev-parse", "--verify", "HEAD"])
      .then(() => true)
      .catch(() => false);
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

  async getBranches(root: string): Promise<GitBranchDto[]> {
    const git = this.git(root);
    const result = await git.branch(["-a", "-vv"]);
    // `-vv`'s tracking marker sits in the same spot in `label` as a commit
    // subject that itself begins with a bracket (e.g. "[JIRA-123] fix the
    // thing"), so it can't be parsed out reliably. Ask git directly instead.
    // `for-each-ref refs/heads` only covers local branches — remote-tracking
    // entries from the `-a` listing above have no upstream of their own, so
    // leaving theirs undefined is correct.
    const raw = await git.raw([
      "for-each-ref",
      "--format=%(refname:short) %(upstream:short)",
      "refs/heads",
    ]);
    const upstreams = new Map<string, string>();
    for (const line of raw.split("\n")) {
      if (!line) continue;
      // Ref names can't contain a space, so splitting on the first one is safe.
      const i = line.indexOf(" ");
      const upstream = line.slice(i + 1);
      if (upstream) upstreams.set(line.slice(0, i), upstream);
    }
    return Object.values(result.branches).map((b) => {
      const upstream = upstreams.get(b.name);
      return {
        name: b.name,
        isCurrent: b.current,
        isRemote: b.name.startsWith("remotes/"),
        ...(upstream && { upstream }),
      };
    });
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
      return;
    }
    const status = await git.status();
    if (status.tracking) {
      await git.push();
      return;
    }
    // No upstream yet — a freshly created branch. A bare push fails here, so
    // establish tracking as part of the first push.
    const names = (await git.getRemotes(false)).map((r) => r.name);
    const target = remote ?? pickRemote(names);
    const head = branch ?? status.current;
    if (!head) throw new Error("Cannot push: no current branch (detached HEAD?).");
    await git.push(["--set-upstream", target, head]);
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
    const raw = await this.git(root).raw(["blame", "--line-porcelain", "--", filePath]);
    return parseBlamePorcelain(raw);
  }

  async getIgnoredPaths(root: string): Promise<string[]> {
    try {
      // -o others (untracked), -i ignored, --exclude-standard honors repo + nested
      // .gitignore, the global core.excludesFile, and .git/info/exclude; --directory
      // collapses a fully-ignored dir to one entry; -z NUL-separates for safe paths.
      const raw = await this.git(root).raw([
        "ls-files",
        "-o",
        "-i",
        "--exclude-standard",
        "--directory",
        "-z",
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
