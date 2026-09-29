import { readFile, realpath, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** The project a session's working directory belongs to, as the wall groups it. */
export interface ProjectGroup {
  /** The group's folder: a repository root, a project root, or the directory itself. */
  path: string;
  /** Set for throwaway sessions run in a temporary directory. */
  scratch?: true;
}

/** Files that mark a folder as a project root when there is no repository. */
const PROJECT_MARKERS = [
  "package.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "CLAUDE.md",
  "AGENTS.md",
];

/** How long a "no repository here" answer holds, so a later `git init` regroups the folder. */
const UNSETTLED_TTL_MS = 60_000;

/** A Claude Code worktree: `<repo>/.claude/worktrees/<name>`, which may already be removed. */
const CLAUDE_WORKTREE = /^(.+?)\/\.claude\/worktrees\/[^/]+(?:\/|$)/;
/** A linked worktree's `.git` file points into `<repo>/.git/worktrees/<name>`. */
const LINKED_WORKTREE = /^(.+)\/\.git\/worktrees\/[^/]+\/?$/;

/**
 * Resolves working directories to the project they belong to, so the wall
 * shows one group per project rather than one per folder: a session that
 * `cd`-ed into a package, and every worktree of a repository, join the
 * repository. Without a repository the nearest folder holding a project file
 * (`package.json`, `CLAUDE.md`, …) is the project; failing that, the directory
 * itself. Neither the home directory nor anything above it counts, so a plain container
 * such as `~/src` never swallows the projects below it. Only local files are
 * read — a repository needs no remote.
 */
export class ProjectGroups {
  private readonly cache = new Map<string, { group: ProjectGroup; until: number }>();
  private scratchRoots?: Promise<string[]>;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly home: string = homedir(),
    private readonly tempDir: string = tmpdir(),
  ) {}

  async resolve(cwd: string): Promise<ProjectGroup> {
    const dir = cwd.replace(/\/+$/, "") || "/";
    const cached = this.cache.get(dir);
    if (cached && cached.until > this.now()) return cached.group;
    const { group, settled } = await this.find(dir);
    this.cache.set(dir, { group, until: settled ? Infinity : this.now() + UNSETTLED_TTL_MS });
    return group;
  }

  private async find(dir: string): Promise<{ group: ProjectGroup; settled: boolean }> {
    const scratch = (await this.scratchDirs()).find((root) => dir === root || dir.startsWith(`${root}/`));
    if (scratch) return { group: { path: scratch, scratch: true }, settled: true };

    const worktree = CLAUDE_WORKTREE.exec(dir);
    if (worktree) return this.find(worktree[1]!);

    let marked: string | undefined;
    for (let at = dir; this.below(at); at = dirname(at)) {
      const repo = await repositoryAt(at);
      if (repo) return { group: { path: repo }, settled: true };
      if (!marked && (await hasMarker(at))) marked = at;
    }
    return { group: { path: marked ?? dir }, settled: false };
  }

  /** False for the filesystem root, the home directory and the folders above it. */
  private below(dir: string): boolean {
    return dir !== "/" && dir !== this.home && !this.home.startsWith(`${dir}/`);
  }

  /** The temp directory under both of its names: macOS reaches it through the `/var` symlink. */
  private scratchDirs(): Promise<string[]> {
    if (!this.scratchRoots) {
      const root = this.tempDir.replace(/\/+$/, "");
      this.scratchRoots = realpath(root)
        .then((real) => [...new Set([root, real])])
        .catch(() => [root]);
    }
    return this.scratchRoots;
  }
}

/**
 * The repository root when `dir` holds a `.git`: the folder itself, or for a
 * linked worktree the main checkout its `.git` file points back to.
 */
async function repositoryAt(dir: string): Promise<string | undefined> {
  const dotGit = join(dir, ".git");
  let isDir: boolean;
  try {
    isDir = (await stat(dotGit)).isDirectory();
  } catch {
    return undefined;
  }
  if (isDir) return dir;
  try {
    const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(dotGit, "utf8"))?.[1]?.trim();
    const main = pointer ? LINKED_WORKTREE.exec(resolve(dir, pointer))?.[1] : undefined;
    return main ?? dir; // a submodule's `.git` file points elsewhere: it is its own project
  } catch {
    return dir;
  }
}

async function hasMarker(dir: string): Promise<boolean> {
  for (const name of PROJECT_MARKERS) {
    try {
      await stat(join(dir, name));
      return true;
    } catch {
      /* not here */
    }
  }
  return false;
}
