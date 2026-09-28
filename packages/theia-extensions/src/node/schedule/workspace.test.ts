import { execFileSync } from "node:child_process";
import type * as ChildProcess from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Workspaces, parseWorktreeList, worktreeBranch, worktreePath } from "./workspace.js";

// A pass-through wrapper around the real execFile, used only by the R17 ordering test below to
// time-stamp each git call. Every other test sees ordinary git behavior; `state.recorder` is unset
// outside that one test.
const state = vi.hoisted(() => ({
  recorder: undefined as ((gitArgs: string[], start: number, end: number) => void) | undefined,
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcess>();
  return {
    ...actual,
    execFile: ((...args: unknown[]) => {
      const gitArgs = args[1] as string[];
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => void;
      const start = performance.now();
      const patched = [...args];
      patched[args.length - 1] = (...cbArgs: unknown[]) => {
        state.recorder?.(gitArgs, start, performance.now());
        cb(...cbArgs);
      };
      return (actual.execFile as (...a: unknown[]) => unknown)(...patched);
    }) as typeof actual.execFile,
  };
});

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
afterEach(() => {
  state.recorder = undefined;
  rmSync(parent, { recursive: true, force: true });
});

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
  it("marks a worktree whose folder git can no longer find as prunable", () => {
    const porcelain =
      "worktree /r\nHEAD abc\nbranch refs/heads/main\n\n" +
      "worktree /r-x\nHEAD def\nbranch refs/heads/x\nprunable gitdir file points to non-existent location\n\n";
    expect(parseWorktreeList(porcelain)).toEqual([
      { path: "/r", branch: "main" },
      { path: "/r-x", branch: "x", prunable: true },
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
    const err = (await w.prepareWorktree(fresh()).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/left from an earlier run.*Retry.*--force.*\ngit -C .*worktree remove.*&&.*git -C .*branch -D/s);
    // the command stands alone on the last line, so copying it never picks up trailing prose or a period.
    expect(err.message.split("\n").at(-1)).toMatch(/^git -C \S+ worktree remove \S+ && git -C \S+ branch -D 'spexr\/s\/t'$/);
  });

  it("a retry makes a worktree for a branch left without one; a new run refuses the branch (R15)", async () => {
    const w = new Workspaces();
    const first = await w.prepareWorktree(fresh());
    g(repo, "worktree", "remove", first); // the branch stays
    const err = (await w.prepareWorktree(fresh()).catch((e: unknown) => e)) as Error;
    expect(err.message).toMatch(/branch spexr\/s\/t is left from an earlier run.*\ngit -C .*branch -D/s);
    expect(err.message.split("\n").at(-1)).toMatch(/^git -C \S+ branch -D 'spexr\/s\/t'$/);
    expect(await w.prepareWorktree({ ...fresh(), reuse: true })).toBe(first);
    expect(g(first, "rev-parse", "--abbrev-ref", "HEAD")).toBe("spexr/s/t");
  });

  it("a retry recovers after the operator deletes the worktree's folder by hand, leaving only git's stale record (R15)", async () => {
    const w = new Workspaces();
    const first = await w.prepareWorktree(fresh());
    rmSync(first, { recursive: true, force: true }); // no `git worktree remove` involved — a bare rm -rf
    expect(g(repo, "worktree", "list", "--porcelain")).toMatch(/prunable/);
    const again = await w.prepareWorktree({ ...fresh(), reuse: true });
    expect(again).toBe(first);
    expect(existsSync(first)).toBe(true);
    expect(g(again, "rev-parse", "--abbrev-ref", "HEAD")).toBe("spexr/s/t");
    // only this task's entry is touched: still exactly the repo root plus this one worktree.
    expect(g(repo, "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(2);
  });

  it("a new run still refuses when the worktree's folder was deleted by hand (R15)", async () => {
    const w = new Workspaces();
    const first = await w.prepareWorktree(fresh());
    rmSync(first, { recursive: true, force: true });
    await expect(w.prepareWorktree(fresh())).rejects.toThrow(/left from an earlier run.*Retry.*worktree remove/s);
  });

  it("never runs a repository-wide prune when recovering: an unrelated stale worktree is left alone (R15)", async () => {
    const other = join(parent, "app-other");
    g(repo, "worktree", "add", "-q", "-b", "other-task", other);
    rmSync(other, { recursive: true, force: true }); // this one becomes prunable too, but isn't ours
    const w = new Workspaces();
    const first = await w.prepareWorktree(fresh());
    rmSync(first, { recursive: true, force: true });
    await w.prepareWorktree({ ...fresh(), reuse: true });
    const stillThere = parseWorktreeList(g(repo, "worktree", "list", "--porcelain")).find((e) => e.branch === "other-task");
    expect(stillThere).toBeDefined();
    expect(stillThere?.prunable).toBe(true); // still prunable: nothing pruned it away
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

  it("serializes two concurrent prepares in one repository: their git critical sections never overlap (R17)", async () => {
    const spans = new Map<string, { start: number; end: number }>();
    state.recorder = (gitArgs, start, end) => {
      const tag = gitArgs.some((a) => a.includes("spexr/s/a")) ? "a" : gitArgs.some((a) => a.includes("spexr/s/b")) ? "b" : undefined;
      if (!tag) return; // the shared `worktree list` / repo-lookup calls don't name a task; only tagged calls count
      const existing = spans.get(tag);
      spans.set(tag, existing ? { start: Math.min(existing.start, start), end: Math.max(existing.end, end) } : { start, end });
    };
    try {
      const w = new Workspaces();
      await Promise.all([
        w.prepareWorktree({ ...fresh(), taskId: "a" }),
        w.prepareWorktree({ ...fresh(), taskId: "b" }),
      ]);
    } finally {
      state.recorder = undefined;
    }
    const a = spans.get("a");
    const b = spans.get("b");
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const overlap = a!.start < b!.end && b!.start < a!.end;
    expect(overlap).toBe(false);
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

describe("Workspaces id guards", () => {
  it("rejects a schedule id that isn't a safe path/argument component", async () => {
    await expect(new Workspaces().prepareWorktree({ ...fresh(), scheduleId: "../evil" })).rejects.toThrow(/schedule id/i);
  });

  it("rejects a task id that isn't a safe path/argument component", async () => {
    await expect(new Workspaces().prepareWorktree({ ...fresh(), taskId: "bad id!" })).rejects.toThrow(/task id/i);
  });
});
