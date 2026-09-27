import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Workspaces, parseWorktreeList, worktreeBranch, worktreePath } from "./workspace.js";

const saved = { GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL, GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM };
beforeAll(() => {
  process.env.GIT_CONFIG_GLOBAL = "/dev/null";
  process.env.GIT_CONFIG_NOSYSTEM = "1";
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const g = (cwd: string, ...args: string[]): string =>
  execFileSync(
    "git",
    ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args],
    { encoding: "utf8" },
  ).trim();

function makeRepo(parent: string, name: string): string {
  const repo = join(parent, name);
  mkdirSync(join(repo, "packages", "web"), { recursive: true });
  writeFileSync(join(repo, "packages", "web", "index.ts"), "export {};\n");
  g(repo, "init", "-q", "--initial-branch=main");
  g(repo, "add", ".");
  g(repo, "commit", "-q", "-m", "init");
  return repo;
}

let parent: string;
let repo: string;
beforeEach(() => {
  parent = realpathSync(mkdtempSync(join(tmpdir(), "spexr-ws-"))); // macOS: /var → /private/var, as git reports it
  repo = makeRepo(parent, "app");
});
afterEach(() => rmSync(parent, { recursive: true, force: true }));

const fresh = () => ({ project: repo, scheduleId: "s", taskId: "t", reuse: false });

describe("worktree naming", () => {
  it("puts the worktree next to the repository, on spexr/<schedule>/<task>", () => {
    expect(worktreeBranch("nightly", "api")).toBe("spexr/nightly/api");
    expect(worktreePath("/src/app", "nightly", "api")).toBe("/src/app-spexr-nightly-api");
  });
  it("reads git's porcelain worktree list", () => {
    expect(parseWorktreeList("worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r-x\nHEAD def\ndetached\n")).toEqual([
      { path: "/r", branch: "main" },
      { path: "/r-x" },
    ]);
  });
});

describe("Workspaces.prepareWorktree", () => {
  it("makes a fresh worktree on spexr/<schedule>/<task> from the project's HEAD, next to the repository (AC-13)", async () => {
    const ws = await new Workspaces().prepareWorktree({ project: repo, scheduleId: "nightly", taskId: "api", reuse: false });
    expect(ws).toBe(join(parent, "app-spexr-nightly-api"));
    expect(g(ws, "rev-parse", "--abbrev-ref", "HEAD")).toBe("spexr/nightly/api");
    expect(g(ws, "rev-parse", "HEAD")).toBe(g(repo, "rev-parse", "HEAD"));
    expect(g(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main"); // the project stays where it was
  });

  it("runs a project that is a folder inside its repository in the same folder of the worktree (R16)", async () => {
    const ws = await new Workspaces().prepareWorktree({ ...fresh(), project: join(repo, "packages", "web") });
    expect(ws).toBe(join(parent, "app-spexr-s-t", "packages", "web"));
    expect(existsSync(join(ws, "index.ts"))).toBe(true);
  });

  it("a retry continues in the same worktree, with the work left there (R15)", async () => {
    const w = new Workspaces();
    const first = await w.prepareWorktree(fresh());
    writeFileSync(join(first, "notes.md"), "half done\n");
    expect(await w.prepareWorktree({ ...fresh(), reuse: true })).toBe(first);
    expect(existsSync(join(first, "notes.md"))).toBe(true);
    expect(g(repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2);
  });

  it("a new run refuses a worktree left from an earlier run, and says how to clean up or continue (R15)", async () => {
    const w = new Workspaces();
    await w.prepareWorktree(fresh());
    await expect(w.prepareWorktree(fresh())).rejects.toThrow(/left from an earlier run.*Retry.*git worktree remove/s);
  });

  it("a retry makes a worktree for a branch left without one; a new run refuses the branch (R15)", async () => {
    const w = new Workspaces();
    const first = await w.prepareWorktree(fresh());
    g(repo, "worktree", "remove", first); // the branch stays
    await expect(w.prepareWorktree(fresh())).rejects.toThrow(/branch spexr\/s\/t is left from an earlier run.*git branch -D/s);
    expect(await w.prepareWorktree({ ...fresh(), reuse: true })).toBe(first);
    expect(g(first, "rev-parse", "--abbrev-ref", "HEAD")).toBe("spexr/s/t");
  });

  it("refuses a folder at the worktree path that is not this task's worktree, and leaves it alone (R19)", async () => {
    const taken = join(parent, "app-spexr-s-t");
    mkdirSync(taken);
    writeFileSync(join(taken, "keep.txt"), "mine");
    const w = new Workspaces();
    await expect(w.prepareWorktree(fresh())).rejects.toThrow(/already exists/);
    await expect(w.prepareWorktree({ ...fresh(), reuse: true })).rejects.toThrow(/already exists/);
    expect(existsSync(join(taken, "keep.txt"))).toBe(true);
  });

  it("refuses a branch checked out in another folder", async () => {
    g(repo, "worktree", "add", "-q", "-b", "spexr/s/t", join(parent, "elsewhere"));
    await expect(new Workspaces().prepareWorktree({ ...fresh(), reuse: true })).rejects.toThrow(/checked out in .*elsewhere/);
  });

  it("refuses a folder outside any git repository", async () => {
    const plain = join(parent, "plain");
    mkdirSync(plain);
    await expect(new Workspaces().prepareWorktree({ ...fresh(), project: plain })).rejects.toThrow(/not inside a git repository/);
  });

  it("starts from a linked worktree's own HEAD when the project is itself a worktree", async () => {
    const linked = join(parent, "app-feature");
    g(repo, "worktree", "add", "-q", "-b", "feature", linked);
    g(linked, "commit", "-q", "--allow-empty", "-m", "feature work");
    const ws = await new Workspaces().prepareWorktree({ ...fresh(), project: linked });
    expect(ws).toBe(join(parent, "app-feature-spexr-s-t"));
    expect(g(ws, "rev-parse", "HEAD")).toBe(g(linked, "rev-parse", "HEAD"));
  });

  it("two siblings prepared at once both get their worktree (R17)", async () => {
    const w = new Workspaces();
    const [a, b] = await Promise.all([
      w.prepareWorktree({ ...fresh(), taskId: "a" }),
      w.prepareWorktree({ ...fresh(), taskId: "b" }),
    ]);
    expect([a, b]).toEqual([join(parent, "app-spexr-s-a"), join(parent, "app-spexr-s-b")]);
  });

  it("never goes through a shell: a repository whose path is shell syntax works and runs nothing (Security)", async () => {
    const odd = makeRepo(parent, "it's $(touch PWNED) ;`touch PWNED2`");
    const ws = await new Workspaces().prepareWorktree({ ...fresh(), project: odd });
    expect(g(ws, "rev-parse", "--abbrev-ref", "HEAD")).toBe("spexr/s/t");
    for (const dir of [parent, odd, ws, process.cwd()]) {
      expect(existsSync(join(dir, "PWNED"))).toBe(false);
      expect(existsSync(join(dir, "PWNED2"))).toBe(false);
    }
  });
});
