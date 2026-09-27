import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { SCHEDULE_ID_PATTERN } from "../../common/schedule/schedule-types.js";

/** A git call never waits longer than this: a hung git must not hold a task in Starting for ever. */
export const GIT_TIMEOUT_MS = 30_000;

export interface WorktreeRequest {
  /** The task's project folder: a repository root or a folder inside one. */
  project: string;
  scheduleId: string;
  taskId: string;
  /** A retry continues on a worktree or branch left from before; a first start refuses them (R15). */
  reuse: boolean;
}

interface Repo {
  toplevel: string;
  /** The project's folder relative to `toplevel`, "" at the root. */
  prefix: string;
  /** Shared by every worktree of the repository: the key worktree changes are serialized on (R17). */
  commonDir: string;
}

/** The branch a worktree task works on (spec, Launch). */
export function worktreeBranch(scheduleId: string, taskId: string): string {
  return `spexr/${scheduleId}/${taskId}`;
}

/** The worktree's folder: a sibling of the repository root, `<repo>-spexr-<schedule>-<task>`. */
export function worktreePath(toplevel: string, scheduleId: string, taskId: string): string {
  return join(dirname(toplevel), `${basename(toplevel)}-spexr-${scheduleId}-${taskId}`);
}

/**
 * The entries of `git worktree list --porcelain`: each folder, its branch when one is checked
 * out, and whether git considers it prunable (its folder is gone, but the entry is not removed
 * until something calls `git worktree remove`/`prune`).
 */
export function parseWorktreeList(porcelain: string): { path: string; branch?: string; prunable?: boolean }[] {
  const out: { path: string; branch?: string; prunable?: boolean }[] = [];
  for (const block of porcelain.split(/\n\n+/)) {
    let path: string | undefined;
    let branch: string | undefined;
    let prunable = false;
    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) path = line.slice("worktree ".length);
      else if (line.startsWith("branch ")) branch = line.slice("branch ".length).replace(/^refs\/heads\//, "");
      else if (line.startsWith("prunable")) prunable = true;
    }
    if (!path) continue;
    const entry: { path: string; branch?: string; prunable?: boolean } = { path };
    if (branch) entry.branch = branch;
    if (prunable) entry.prunable = true;
    out.push(entry);
  }
  return out;
}

/** Run git with an argument list, never a shell: no path or id is ever read as shell syntax. */
function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", ["-C", cwd, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr).trim() || err.message));
      else resolve(String(stdout));
    });
  });
}

/** The task's folder inside the worktree (R16); a folder git does not track has no copy there. */
function inside(path: string, prefix: string): string {
  const cwd = prefix ? join(path, prefix) : path;
  if (!existsSync(cwd)) throw new Error(`${cwd} does not exist in the worktree: git tracks nothing in that folder.`);
  return cwd;
}

/** Quotes a single shell argument so a cleanup command someone reads out of an error can be pasted as-is. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A `git worktree remove` command that works from any cwd, naming the repository explicitly. */
function worktreeRemoveCmd(toplevel: string, path: string): string {
  return `git -C ${shQuote(toplevel)} worktree remove ${shQuote(path)}`;
}

/** A `git branch -D` command that works from any cwd, naming the repository explicitly. */
function branchDeleteCmd(toplevel: string, branch: string): string {
  return `git -C ${shQuote(toplevel)} branch -D ${shQuote(branch)}`;
}

/**
 * Worktree workspaces for scheduled tasks. Changes are serialized per
 * repository (R17): siblings starting together would otherwise race on
 * git's locks in the shared git dir.
 */
export class Workspaces {
  private readonly queues = new Map<string, Promise<void>>();

  /** Make (or, on retry, reuse) the task's worktree; resolves the folder the task runs in. */
  async prepareWorktree(req: WorktreeRequest): Promise<string> {
    if (!SCHEDULE_ID_PATTERN.test(req.scheduleId)) {
      throw new Error(`Invalid schedule id "${req.scheduleId}": use 1–32 lowercase letters, digits or dashes.`);
    }
    if (!SCHEDULE_ID_PATTERN.test(req.taskId)) {
      throw new Error(`Invalid task id "${req.taskId}": use 1–32 lowercase letters, digits or dashes.`);
    }
    const repo = await this.repoOf(req.project);
    return this.serial(repo.commonDir, () => this.ensure(repo, req));
  }

  private async repoOf(project: string): Promise<Repo> {
    let out: string;
    try {
      out = await git(project, ["rev-parse", "--path-format=absolute", "--show-toplevel", "--show-prefix", "--git-common-dir"]);
    } catch (err) {
      throw new Error(`${project} is not inside a git repository, so it cannot have a worktree (${(err as Error).message}).`);
    }
    const [toplevel = "", prefix = "", commonDir = ""] = out.split("\n");
    return { toplevel, prefix: prefix.replace(/\/+$/, ""), commonDir };
  }

  private async ensure(repo: Repo, req: WorktreeRequest): Promise<string> {
    const branch = worktreeBranch(req.scheduleId, req.taskId);
    const path = worktreePath(repo.toplevel, req.scheduleId, req.taskId);
    const leftoverWorktree = (): Error =>
      new Error(
        `The worktree ${path} is left from an earlier run. Press Retry to continue on it, or remove it first: ` +
          `${worktreeRemoveCmd(repo.toplevel, path)} && ${branchDeleteCmd(repo.toplevel, branch)} ` +
          `(add --force to worktree remove if it has uncommitted changes).`,
      );
    const leftoverBranch = (): Error =>
      new Error(
        `The branch ${branch} is left from an earlier run. Press Retry to continue on it, or remove it first: ` +
          `${branchDeleteCmd(repo.toplevel, branch)}.`,
      );
    const onBranch = parseWorktreeList(await git(repo.toplevel, ["worktree", "list", "--porcelain"])).find(
      (w) => w.branch === branch,
    );
    if (onBranch) {
      if (onBranch.path !== path) throw new Error(`${branch} is checked out in ${onBranch.path}; this task needs it in ${path}.`);
      if (!req.reuse) throw leftoverWorktree();
      if (onBranch.prunable) {
        // The operator (or something outside SPEXR) deleted the worktree's folder directly, so git
        // still holds the administrative entry for it (R15). Clear only this one entry — never a
        // repo-wide prune, which would also sweep up unrelated stale worktrees — then recreate it
        // on the same branch.
        await git(repo.toplevel, ["worktree", "remove", "--force", path]);
        await git(repo.toplevel, ["worktree", "add", path, branch]);
      }
      return inside(path, repo.prefix);
    }
    if (existsSync(path)) throw new Error(`${path} already exists and is not this task's worktree. Move it away, or rename the task.`);
    const branchExists = await git(repo.toplevel, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).then(
      () => true,
      () => false,
    );
    if (branchExists && !req.reuse) throw leftoverBranch();
    await git(repo.toplevel, branchExists ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, "HEAD"]);
    return inside(path, repo.prefix);
  }

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(key) ?? Promise.resolve()).then(fn, fn);
    const tail = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, tail);
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key);
    });
    return next;
  }
}
