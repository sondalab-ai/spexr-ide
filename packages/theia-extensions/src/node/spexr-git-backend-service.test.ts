import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execSync } from "child_process";
import type { FSWatcher } from "node:fs";
import {
  SpexrGitBackendService,
  parseBlamePorcelain,
  normalizeRemoteUrl,
  parseIgnoredPaths,
  pickRemote,
  mapFileChange,
} from "./spexr-git-backend-service.js";

describe("SpexrGitBackendService", () => {
  let tmpDir: string;
  let service: SpexrGitBackendService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-git-test-"));
    execSync("git init", { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, "README.md"), "init");
    execSync("git add README.md", { cwd: tmpDir });
    execSync('git commit -m "init"', { cwd: tmpDir });
    service = new SpexrGitBackendService();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("getStatus: returns clean state on fresh repo", async () => {
    const status = await service.getStatus(tmpDir);
    expect(status.isClean).toBe(true);
    expect(status.files).toHaveLength(0);
    expect(typeof status.branch).toBe("string");
    expect(status.branch.length).toBeGreaterThan(0);
  });

  it("getStatus: detects untracked file", async () => {
    fs.writeFileSync(path.join(tmpDir, "new.txt"), "hello");
    const status = await service.getStatus(tmpDir);
    expect(status.isClean).toBe(false);
    const f = status.files.find((x) => x.path === "new.txt");
    expect(f).toBeDefined();
    expect(f!.unstagedState).toBe("?");
    expect(f!.stagedState).toBeUndefined();
  });

  it("getStatus: detects a real merge conflict as unmerged (U), end to end", async () => {
    // Both branches modify the same line of the same file — a classic "both
    // modified" (UU) conflict. This exercises simple-git's real status
    // parsing, not just mapFileChange in isolation: simple-git routes
    // conflicted entries into status.conflicted, and this asserts that its
    // index/working_dir chars still arrive at getStatus as "U"/"U".
    fs.writeFileSync(path.join(tmpDir, "f.txt"), "line one\n");
    execSync("git add f.txt && git commit -m base", { cwd: tmpDir });

    execSync("git checkout -b branchA", { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, "f.txt"), "line one from A\n");
    execSync('git commit -am "A: modify"', { cwd: tmpDir });

    execSync("git checkout -", { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, "f.txt"), "line one from main\n");
    execSync('git commit -am "main: modify"', { cwd: tmpDir });

    try {
      execSync("git merge branchA", { cwd: tmpDir, stdio: "ignore" });
    } catch {
      // Merge conflict — expected; git exits non-zero.
    }

    const status = await service.getStatus(tmpDir);
    const f = status.files.find((x) => x.path === "f.txt");
    expect(f?.unstagedState).toBe("U");
    expect(f?.stagedState).toBeUndefined();
  });

  it("getIgnoredPaths: returns ignored files and collapses ignored dirs", async () => {
    fs.writeFileSync(path.join(tmpDir, ".gitignore"), "dist/\n*.log\n");
    fs.mkdirSync(path.join(tmpDir, "dist"));
    fs.writeFileSync(path.join(tmpDir, "dist", "bundle.js"), "x");
    fs.writeFileSync(path.join(tmpDir, "debug.log"), "x");
    fs.writeFileSync(path.join(tmpDir, "keep.ts"), "x");

    const ignored = await service.getIgnoredPaths(tmpDir);
    expect(ignored).toContain("dist/"); // whole dir collapsed to one entry
    expect(ignored).toContain("debug.log");
    expect(ignored).not.toContain("keep.ts");
    expect(ignored).not.toContain("dist/bundle.js"); // covered by dist/
  });

  it("getIgnoredPaths: returns [] outside a git repo", async () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-nonrepo-"));
    try {
      expect(await service.getIgnoredPaths(nonRepo)).toEqual([]);
    } finally {
      fs.rmSync(nonRepo, { recursive: true, force: true });
    }
  });

  it("stage: moves untracked file to staged (A)", async () => {
    fs.writeFileSync(path.join(tmpDir, "new.txt"), "hello");
    await service.stage(tmpDir, ["new.txt"]);
    const status = await service.getStatus(tmpDir);
    const f = status.files.find((x) => x.path === "new.txt");
    expect(f?.stagedState).toBe("A");
  });

  it("unstage: reverts staged new file back to untracked", async () => {
    fs.writeFileSync(path.join(tmpDir, "new.txt"), "hello");
    await service.stage(tmpDir, ["new.txt"]);
    await service.unstage(tmpDir, ["new.txt"]);
    const status = await service.getStatus(tmpDir);
    const f = status.files.find((x) => x.path === "new.txt");
    expect(f?.stagedState).toBeUndefined();
    expect(f?.unstagedState).toBe("?");
  });

  it("unstage: an empty path list is a no-op, not a full index reset", async () => {
    // git reset HEAD -- (no paths) exits 0 and empties the WHOLE index,
    // unlike `git add` with no paths, which is a no-op. stage/unstage must
    // stay symmetric.
    fs.writeFileSync(path.join(tmpDir, "new.txt"), "hello");
    await service.stage(tmpDir, ["new.txt"]);
    await service.unstage(tmpDir, []);
    const status = await service.getStatus(tmpDir);
    const f = status.files.find((x) => x.path === "new.txt");
    expect(f?.stagedState).toBe("A");
  });

  it("discard: restores a tracked modified file", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "changed");
    await service.discard(tmpDir, ["README.md"]);
    expect(fs.readFileSync(path.join(tmpDir, "README.md"), "utf8")).toBe("init");
  });

  it("discard: deletes an untracked file", async () => {
    fs.writeFileSync(path.join(tmpDir, "junk.txt"), "x");
    await service.discard(tmpDir, ["junk.txt"]);
    expect(fs.existsSync(path.join(tmpDir, "junk.txt"))).toBe(false);
  });

  it("discard: handles a mixed list in one call", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "changed");
    fs.writeFileSync(path.join(tmpDir, "junk.txt"), "x");
    await service.discard(tmpDir, ["README.md", "junk.txt"]);
    expect(fs.readFileSync(path.join(tmpDir, "README.md"), "utf8")).toBe("init");
    expect(fs.existsSync(path.join(tmpDir, "junk.txt"))).toBe(false);
  });

  it("discard: ignores paths that are already clean", async () => {
    await expect(service.discard(tmpDir, ["README.md"])).resolves.toBeUndefined();
  });

  it("discard: reverts to staged content, not HEAD, when both differ", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "staged");
    await service.stage(tmpDir, ["README.md"]);
    fs.writeFileSync(path.join(tmpDir, "README.md"), "unstaged");

    await service.discard(tmpDir, ["README.md"]);

    expect(fs.readFileSync(path.join(tmpDir, "README.md"), "utf8")).toBe("staged");
    const status = await service.getStatus(tmpDir);
    const f = status.files.find((x) => x.path === "README.md");
    expect(f?.stagedState).toBe("M");
  });

  it("commit: staged file produces clean status", async () => {
    fs.writeFileSync(path.join(tmpDir, "new.txt"), "hello");
    await service.stage(tmpDir, ["new.txt"]);
    await service.commit(tmpDir, "test commit");
    const status = await service.getStatus(tmpDir);
    expect(status.isClean).toBe(true);
  });

  it("getLog: returns at least the initial commit", async () => {
    const log = await service.getLog(tmpDir, 5);
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0].message).toBe("init");
    expect(log[0].hash).toHaveLength(7);
  });

  it("getBranches: returns current branch", async () => {
    const branches = await service.getBranches(tmpDir);
    const current = branches.find((b) => b.isCurrent);
    expect(current).toBeDefined();
    expect(current!.isRemote).toBe(false);
  });

  describe("pickRemote", () => {
    it("prefers origin", () => expect(pickRemote(["upstream", "origin"])).toBe("origin"));
    it("takes the sole remote when there is no origin", () => expect(pickRemote(["fork"])).toBe("fork"));
    it("throws, naming candidates, when ambiguous", () => {
      expect(() => pickRemote(["a", "b"])).toThrow(/a, b/);
    });
    it("throws when there are none", () => expect(() => pickRemote([])).toThrow(/no remote/i));
  });

  it("push: sets upstream on a branch that has none", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-git-bare-"));
    execSync("git init --bare", { cwd: bare });
    execSync(`git remote add origin ${bare}`, { cwd: tmpDir });
    execSync("git checkout -b feature", { cwd: tmpDir });

    await service.push(tmpDir); // must not throw despite no upstream

    const status = await service.getStatus(tmpDir);
    expect(status.upstream).toBe("origin/feature");
    fs.rmSync(bare, { recursive: true, force: true });
  });

  it("getBranches: reports the upstream of a tracking branch", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-git-bare2-"));
    execSync("git init --bare", { cwd: bare });
    execSync(`git remote add origin ${bare}`, { cwd: tmpDir });
    execSync("git push -u origin HEAD", { cwd: tmpDir });

    const branches = await service.getBranches(tmpDir);
    const current = branches.find((b) => b.isCurrent);
    expect(current?.upstream).toMatch(/^origin\//);
    fs.rmSync(bare, { recursive: true, force: true });
  });

  it("getBranches: does not mistake a bracketed commit subject for an upstream", async () => {
    execSync("git checkout -b jira", { cwd: tmpDir });
    execSync('git commit --allow-empty -m "[JIRA-123] fix the thing"', { cwd: tmpDir });

    const branches = await service.getBranches(tmpDir);
    const current = branches.find((b) => b.isCurrent);
    expect(current?.upstream).toBeUndefined();
  });

  it("createBranch + checkout: switches to new branch", async () => {
    await service.createBranch(tmpDir, "feature/test", true);
    const status = await service.getStatus(tmpDir);
    expect(status.branch).toBe("feature/test");
  });

  it("getBlame: maps committed lines to their commit", async () => {
    fs.writeFileSync(path.join(tmpDir, "code.txt"), "line one\nline two\n");
    execSync("git add code.txt", { cwd: tmpDir });
    execSync('git commit -m "add code"', { cwd: tmpDir });

    const blame = await service.getBlame(tmpDir, "code.txt");
    expect(blame.lines).toHaveLength(2);
    expect(blame.lines[0].line).toBe(1);
    expect(blame.lines[1].line).toBe(2);

    const commit = blame.commits[blame.lines[0].hash];
    expect(commit).toBeDefined();
    expect(commit.author).toBe("Test");
    expect(commit.authorMail).toBe("test@test.com");
    expect(commit.summary).toBe("add code");
    expect(commit.authorTime).toBeGreaterThan(0);
    // Both lines share the same commit.
    expect(blame.lines[1].hash).toBe(blame.lines[0].hash);
  });

  it("getBlame: marks uncommitted working-tree lines with the all-zero hash", async () => {
    fs.writeFileSync(path.join(tmpDir, "wip.txt"), "committed\n");
    execSync("git add wip.txt", { cwd: tmpDir });
    execSync('git commit -m "base"', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, "wip.txt"), "committed\nuncommitted\n");

    const blame = await service.getBlame(tmpDir, "wip.txt");
    expect(blame.lines).toHaveLength(2);
    expect(blame.lines[1].hash).toMatch(/^0{40}$/);
  });

  it("getBlame: rejects path traversal", async () => {
    await expect(service.getBlame(tmpDir, "../etc/passwd")).rejects.toThrow();
  });

  it("getRemoteUrl: returns undefined without a remote", async () => {
    expect(await service.getRemoteUrl(tmpDir)).toBeUndefined();
  });

  it("getRemoteUrl: normalizes the origin remote", async () => {
    execSync("git remote add origin git@github.com:foo/bar.git", { cwd: tmpDir });
    expect(await service.getRemoteUrl(tmpDir)).toBe("https://github.com/foo/bar");
  });

  it("git(): returns the same instance for one root and serializes it", () => {
    const svc = service as unknown as { git(root: string): unknown };
    const a = svc.git(tmpDir);
    const b = svc.git(tmpDir);
    expect(a).toBe(b);
  });

  it("git(): distinct instances for distinct roots", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-git-other-"));
    execSync("git init", { cwd: other });
    const svc = service as unknown as { git(root: string): unknown };
    expect(svc.git(tmpDir)).not.toBe(svc.git(other));
    fs.rmSync(other, { recursive: true, force: true });
  });

  it("resolveGitDir: returns the .git directory of a normal repo", async () => {
    const dir = await service.resolveGitDir(tmpDir);
    expect(dir).toBeDefined();
    expect(fs.existsSync(path.join(dir!, "HEAD"))).toBe(true);
  });

  it("resolveGitDir: follows the gitdir pointer of a linked worktree", async () => {
    const wt = path.join(os.tmpdir(), `spexr-wt-${Date.now()}`);
    execSync(`git worktree add -b wt-branch ${wt}`, { cwd: tmpDir });
    try {
      // In a linked worktree `.git` is a FILE containing "gitdir: <path>".
      expect(fs.statSync(path.join(wt, ".git")).isFile()).toBe(true);

      const dir = await service.resolveGitDir(wt);
      expect(dir).toBeDefined();
      expect(fs.existsSync(path.join(dir!, "HEAD"))).toBe(true);
    } finally {
      execSync(`git worktree remove --force ${wt}`, { cwd: tmpDir });
    }
  });

  it("resolveGitDir: returns undefined outside a repository", async () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-plain-"));
    expect(await service.resolveGitDir(plain)).toBeUndefined();
    fs.rmSync(plain, { recursive: true, force: true });
  });
});

describe("normalizeRemoteUrl", () => {
  it.each([
    ["git@github.com:foo/bar.git", "https://github.com/foo/bar"],
    ["https://github.com/foo/bar.git", "https://github.com/foo/bar"],
    ["https://gitlab.com/group/sub/repo.git", "https://gitlab.com/group/sub/repo"],
    ["ssh://git@github.com/foo/bar.git", "https://github.com/foo/bar"],
    ["git://github.com/foo/bar.git", "https://github.com/foo/bar"],
    ["https://github.com/foo/bar/", "https://github.com/foo/bar"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeRemoteUrl(input)).toBe(expected);
  });

  it("returns undefined for empty or non-http input", () => {
    expect(normalizeRemoteUrl("")).toBeUndefined();
    expect(normalizeRemoteUrl("file:///local/path")).toBeUndefined();
  });
});

describe("parseIgnoredPaths", () => {
  it("splits NUL-separated paths and drops empties", () => {
    expect(parseIgnoredPaths("dist/\0debug.log\0node_modules/\0")).toEqual([
      "dist/", "debug.log", "node_modules/",
    ]);
  });
  it("returns [] for empty output", () => {
    expect(parseIgnoredPaths("")).toEqual([]);
    expect(parseIgnoredPaths("\0")).toEqual([]);
  });
});

describe("parseBlamePorcelain", () => {
  it("deduplicates commits and parses fields", () => {
    const raw = [
      "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 1 1 2",
      "author Jane Doe",
      "author-mail <jane@example.com>",
      "author-time 1700000000",
      "author-tz +0000",
      "summary first commit",
      "filename code.txt",
      "\tline one",
      "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0 2 2",
      "author Jane Doe",
      "author-mail <jane@example.com>",
      "author-time 1700000000",
      "author-tz +0000",
      "summary first commit",
      "filename code.txt",
      "\tline two",
      "",
    ].join("\n");

    const result = parseBlamePorcelain(raw);
    expect(result.lines).toEqual([
      { line: 1, hash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" },
      { line: 2, hash: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0" },
    ]);
    expect(Object.keys(result.commits)).toHaveLength(1);
    const commit = result.commits["a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0"];
    expect(commit.author).toBe("Jane Doe");
    expect(commit.authorMail).toBe("jane@example.com");
    expect(commit.authorTime).toBe(1700000000);
    expect(commit.summary).toBe("first commit");
  });
});

describe("SpexrGitBackendService — virgin repo (no commits)", () => {
  let tmpDir: string;
  let service: SpexrGitBackendService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-git-virgin-"));
    execSync("git init", { cwd: tmpDir });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir });
    execSync('git config user.name "Test"', { cwd: tmpDir });
    service = new SpexrGitBackendService();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("unstage: works on repo without HEAD (no commits yet)", async () => {
    fs.writeFileSync(path.join(tmpDir, "new.txt"), "hello");
    await service.stage(tmpDir, ["new.txt"]);
    await expect(service.unstage(tmpDir, ["new.txt"])).resolves.not.toThrow();
    const status = await service.getStatus(tmpDir);
    const f = status.files.find((x) => x.path === "new.txt");
    expect(f?.stagedState).toBeUndefined();
    expect(f?.unstagedState).toBe("?");
  });
});

describe("SpexrGitBackendService — repository watcher", () => {
  let tmpDir: string;
  let watched: { dir: string; recursive: boolean }[];
  let fire: (() => void)[];
  let service: SpexrGitBackendService;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-git-watch-"));
    execSync("git init", { cwd: tmpDir });
    watched = [];
    fire = [];
    service = new SpexrGitBackendService({
      watchDir: (dir, recursive, onChange) => {
        watched.push({ dir, recursive });
        fire.push(onChange);
        return { close: () => {} } as unknown as FSWatcher;
      },
    });
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("arms watchers on the resolved git dir after setClient", async () => {
    service.setClient({ onRepositoryChanged: () => {} });
    await service.getStatus(tmpDir); // first call binds the root
    await vi.waitFor(() => expect(watched.length).toBeGreaterThan(0));

    const dirs = watched.map((w) => path.basename(w.dir));
    expect(dirs).toContain(".git");
    expect(watched.some((w) => w.dir.endsWith(path.join(".git", "refs")) && w.recursive)).toBe(true);
  });

  it("debounces a burst of changes into one notification", async () => {
    let calls = 0;
    service.setClient({ onRepositoryChanged: () => { calls += 1; } });
    await service.getStatus(tmpDir);
    await vi.waitFor(() => expect(fire.length).toBeGreaterThan(0));

    fire[0]!(); fire[0]!(); fire[0]!();
    expect(calls).toBe(0);                       // nothing yet — debounced
    await new Promise((r) => setTimeout(r, 250));
    expect(calls).toBe(1);                       // exactly one, not three
  });

  it("does not throw when the watch target cannot be watched", async () => {
    const failing = new SpexrGitBackendService({
      watchDir: () => { throw new Error("EPERM"); },
    });
    failing.setClient({ onRepositoryChanged: () => {} });
    await expect(failing.getStatus(tmpDir)).resolves.toBeDefined();
  });

  it("does not stack another watcher on a second getStatus for the same root", async () => {
    service.setClient({ onRepositoryChanged: () => {} });
    await service.getStatus(tmpDir);
    await vi.waitFor(() => expect(watched.length).toBeGreaterThan(0));
    const countAfterFirst = watched.length;

    await service.getStatus(tmpDir);
    expect(watched.length).toBe(countAfterFirst);
  });

  it("retries arming on the next getStatus after every watch attempt failed, instead of muting the root forever", async () => {
    let shouldFail = true;
    const flaky = new SpexrGitBackendService({
      watchDir: (dir, recursive, onChange) => {
        if (shouldFail) throw new Error("EPERM");
        watched.push({ dir, recursive });
        fire.push(onChange);
        return { close: () => {} } as unknown as FSWatcher;
      },
    });
    flaky.setClient({ onRepositoryChanged: () => {} });
    await flaky.getStatus(tmpDir); // both watch attempts throw → root must stay unarmed
    expect(watched.length).toBe(0);

    shouldFail = false;
    await flaky.getStatus(tmpDir); // permissions recovered → arming must be retried, not skipped
    await vi.waitFor(() => expect(watched.length).toBeGreaterThan(0));
  });

  it("watches refs under the common dir, not the worktree's own empty one", async () => {
    execSync('git config user.email "t@t.t"', { cwd: tmpDir });
    execSync('git config user.name "T"', { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, "a.txt"), "x");
    execSync("git add a.txt && git commit -m init", { cwd: tmpDir });
    const wt = path.join(os.tmpdir(), `spexr-wt-watch-${Date.now()}`);
    execSync(`git worktree add -b wt-watch ${wt}`, { cwd: tmpDir });

    try {
      service.setClient({ onRepositoryChanged: () => {} });
      await service.getStatus(wt);
      await vi.waitFor(() => expect(watched.length).toBeGreaterThan(0));

      const refsWatch = watched.find((w) => w.dir.endsWith(`${path.sep}refs`));
      expect(refsWatch).toBeDefined();
      // The common dir's refs, which actually holds heads/ — not the worktree's.
      expect(fs.existsSync(path.join(refsWatch!.dir, "heads"))).toBe(true);
    } finally {
      execSync(`git worktree remove --force ${wt}`, { cwd: tmpDir });
    }
  });
});

describe("mapFileChange — conflict and untracked states", () => {
  it("marks untracked with ?, not U", () => {
    expect(mapFileChange("new.txt", "?", "?")).toEqual({ path: "new.txt", unstagedState: "?" });
  });

  it.each([["U", "U"], ["A", "A"], ["D", "D"], ["A", "U"], ["U", "A"], ["D", "U"], ["U", "D"]])(
    "treats %s%s as a conflict",
    (index, worktree) => {
      const r = mapFileChange("f.txt", index, worktree);
      expect(r?.unstagedState).toBe("U");
    },
  );

  it("still maps a plain staged modification", () => {
    expect(mapFileChange("f.txt", "M", " ")).toEqual({ path: "f.txt", stagedState: "M" });
  });
});
