import { injectable } from "@theia/core/shared/inversify";
import simpleGit, { type SimpleGit } from "simple-git";
import type {
  SpexrGitService,
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

  private git(root: string): SimpleGit {
    let client = this.clients.get(root);
    if (!client) {
      client = simpleGit(root, { maxConcurrentProcesses: 1 });
      this.clients.set(root, client);
    }
    return client;
  }

  async getStatus(root: string): Promise<GitStatusDto> {
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
