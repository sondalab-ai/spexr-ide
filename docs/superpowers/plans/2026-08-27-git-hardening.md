# Git Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SPEXR's see → stage → commit → push loop trustworthy: the panel reflects git activity from any source, single files can be staged and discarded, new branches push, and conflicts are visibly distinct from edits.

**Architecture:** The backend gains one cached `SimpleGit` instance per repository root (concurrency 1, so simple-git's own scheduler serializes) and a `node:fs` watcher on the resolved git directory that pushes `onRepositoryChanged` to the frontend over a new `SpexrGitClient` RPC channel. The frontend provider becomes a client of that channel and refreshes reactively with a single-flight guard. Per-file operations, upstream-aware push, a status-bar indicator, and a conflict group build on that base.

**Tech Stack:** TypeScript, Theia 1.71 (`@theia/scm`, `@theia/core`), `simple-git` 3.36, Inversify, Vitest.

**Spec:** `docs/specs/0014-git-hardening.md`

## Global Constraints

- Every path crossing the `SpexrGitService` boundary is **relative to the repository root**, never absolute.
- All git access inside `SpexrGitBackendService` goes through the private `git(root)` accessor — no bare `simpleGit(...)` calls after Task 1.
- Backend tests use real temporary repositories via `execSync("git init")`, matching the existing style in `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`.
- Filesystem watching goes through an injected seam so tests never watch real files, matching `watchDir` in `node/darkfactory/spexr-darkfactory-backend-service.ts`.
- Run after every task: `pnpm --filter @spexr/theia-extensions run typecheck && pnpm --filter @spexr/theia-extensions run lint && (cd packages/theia-extensions && pnpm test)`.
- Baseline: the **root** `pnpm test` is already red on `main` (https://github.com/sondalab-ai/spexr-ide/issues/13). Judge only the `@spexr/theia-extensions` suite, which is 340/340 green at `4a9f06f`.
- Branch: `feat/git-hardening`, already created off `main` with the spec committed at `22230f6`.
- These constraints are spec **AC-19** (no regression at any slice boundary); every task inherits them, which is why no individual task cites it.

---

## Slice 1 — Backend foundations

### Task 1: Cache one SimpleGit instance per root

**Implements:** AC-1 of `docs/specs/0014-git-hardening.md`

**Files:**
- Modify: `packages/theia-extensions/src/node/spexr-git-backend-service.ts`
- Test: `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `private git(root: string): SimpleGit` on `SpexrGitBackendService` — every later task uses this instead of `simpleGit(root)`.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm vitest run src/node/spexr-git-backend-service.test.ts -t "git()"`
Expected: FAIL — `svc.git is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to the class, above `getStatus`:

```ts
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
```

Import the type: `import simpleGit, { type SimpleGit } from "simple-git";`

- [ ] **Step 4: Replace every inline construction**

Replace all sixteen `simpleGit(root)` occurrences in method bodies with `this.git(root)`. Affected methods: `getStatus`, `stage`, `unstage`, `commit`, `getDiff`, `getBranches`, `checkout`, `createBranch`, `push`, `pull`, `fetch`, `getLog`, `getFileAtRevision`, `getBlame`, `getIgnoredPaths`, `getRemoteUrl`.

Verify none remain: `grep -n "simpleGit(" src/node/spexr-git-backend-service.ts` should show only the import and the one call inside `git()`.

- [ ] **Step 5: Run the full suite**

Run: `cd packages/theia-extensions && pnpm test`
Expected: PASS, 342 tests (340 existing + 2 new).

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/node/spexr-git-backend-service.ts packages/theia-extensions/src/node/spexr-git-backend-service.test.ts
git commit -m "perf(git): one serialized SimpleGit instance per repository root"
```

---

### Task 2: Resolve the git directory instead of assuming it

**Implements:** AC-2 of `docs/specs/0014-git-hardening.md`

**Files:**
- Modify: `packages/theia-extensions/src/node/spexr-git-backend-service.ts`
- Test: `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`

**Interfaces:**
- Consumes: `this.git(root)` from Task 1
- Produces: `async resolveGitDir(root: string): Promise<string | undefined>` — exported from the module (not just a private method) so Task 3's watcher test can call it directly. Returns an absolute path, or `undefined` outside a repository.

- [ ] **Step 1: Write the failing test**

```ts
it("resolveGitDir: returns the .git directory of a normal repo", async () => {
  const dir = await service.resolveGitDir(tmpDir);
  expect(dir).toBeDefined();
  expect(fs.existsSync(path.join(dir!, "HEAD"))).toBe(true);
});

it("resolveGitDir: follows the gitdir pointer of a linked worktree", async () => {
  const wt = path.join(os.tmpdir(), `spexr-wt-${Date.now()}`);
  execSync(`git worktree add -b wt-branch ${wt}`, { cwd: tmpDir });
  // In a linked worktree `.git` is a FILE containing "gitdir: <path>".
  expect(fs.statSync(path.join(wt, ".git")).isFile()).toBe(true);

  const dir = await service.resolveGitDir(wt);
  expect(dir).toBeDefined();
  expect(fs.existsSync(path.join(dir!, "HEAD"))).toBe(true);

  execSync(`git worktree remove --force ${wt}`, { cwd: tmpDir });
});

it("resolveGitDir: returns undefined outside a repository", async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), "spexr-plain-"));
  expect(await service.resolveGitDir(plain)).toBeUndefined();
  fs.rmSync(plain, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm vitest run src/node/spexr-git-backend-service.test.ts -t "resolveGitDir"`
Expected: FAIL — `service.resolveGitDir is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
  /**
   * Absolute path of the repository's git directory.
   *
   * Must not be derived as `root + "/.git"`: in a linked worktree `.git` is a
   * FILE holding a `gitdir:` pointer, so assuming a directory there yields a
   * path that never emits watch events. `rev-parse --git-dir` answers
   * correctly for plain repos, worktrees, and submodules alike.
   */
  async resolveGitDir(root: string): Promise<string | undefined> {
    try {
      const out = (await this.git(root).raw(["rev-parse", "--git-dir"])).trim();
      if (!out) return undefined;
      return isAbsolute(out) ? out : resolvePath(root, out);
    } catch {
      return undefined; // not a repository
    }
  }
```

Add imports: `import { isAbsolute, resolve as resolvePath, join } from "node:path";`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/theia-extensions && pnpm vitest run src/node/spexr-git-backend-service.test.ts -t "resolveGitDir"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/spexr-git-backend-service.ts packages/theia-extensions/src/node/spexr-git-backend-service.test.ts
git commit -m "feat(git): resolve the git dir via rev-parse, worktree-safe"
```

---

### Task 3: Watch the git directory and push changes to the frontend

**Implements:** AC-3, AC-4 of `docs/specs/0014-git-hardening.md`

**Files:**
- Modify: `packages/theia-extensions/src/common/git-protocol.ts`
- Modify: `packages/theia-extensions/src/node/spexr-git-backend-service.ts`
- Modify: `packages/theia-extensions/src/node/spexr-backend-module.ts`
- Test: `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`

**Interfaces:**
- Consumes: `resolveGitDir` from Task 2
- Produces:
  - `interface SpexrGitClient { onRepositoryChanged(): void }` exported from `common/git-protocol.ts`
  - `setClient(client: SpexrGitClient): void` on `SpexrGitService`
  - Constructor option `watchDir?: (dir: string, recursive: boolean, onChange: () => void) => FSWatcher` on `SpexrGitBackendService`

- [ ] **Step 1: Add the protocol members**

In `common/git-protocol.ts`, after the DTO declarations:

```ts
/** Push channel: backend → frontend. */
export interface SpexrGitClient {
  /** The repository changed on disk — from this IDE, a terminal, or anything else. */
  onRepositoryChanged(): void;
}
```

and inside `interface SpexrGitService`, as the first member:

```ts
  /** Registers the push channel and arms the repository watcher. */
  setClient(client: SpexrGitClient): void;
```

- [ ] **Step 2: Write the failing test**

```ts
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
});
```

Add to the test file's imports: `import { vi } from "vitest";` and `import type { FSWatcher } from "node:fs";`

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm vitest run src/node/spexr-git-backend-service.test.ts -t "repository watcher"`
Expected: FAIL — the constructor takes no arguments and `setClient` does not exist.

- [ ] **Step 4: Implement the watcher**

Add near the top of `spexr-git-backend-service.ts`:

```ts
import { watch, type FSWatcher } from "node:fs";
import { unmanaged } from "@theia/core/shared/inversify";

/** Coalesce a burst of git-dir writes (one operation touches several files). */
const WATCH_DEBOUNCE_MS = 150;

export interface GitBackendDeps {
  /** Directory-watch seam (default: node:fs `watch`); tests capture the calls. */
  watchDir?: (dir: string, recursive: boolean, onChange: () => void) => FSWatcher;
}
```

Then inside the class:

```ts
  private readonly watchDir: (dir: string, recursive: boolean, onChange: () => void) => FSWatcher;
  private client?: SpexrGitClient;
  private readonly watchers: FSWatcher[] = [];
  /** Roots already armed, so repeated getStatus calls do not stack watchers. */
  private readonly armed = new Set<string>();
  private debounce?: ReturnType<typeof setTimeout>;

  constructor(@unmanaged() deps: GitBackendDeps = {}) {
    this.watchDir =
      deps.watchDir ?? ((dir, recursive, onChange) => watch(dir, { recursive }, onChange));
  }

  setClient(client: SpexrGitClient): void {
    this.client = client;
  }

  /**
   * Watch the git dir so operations that touch only `.git` — commit, fetch,
   * branch create, and `git add` from a terminal — reach the panel. Theia's
   * file watcher excludes `.git` by default, so without this the panel only
   * ever sees its own writes.
   */
  private armWatch(root: string, gitDir: string): void {
    if (this.armed.has(root)) return;
    this.armed.add(root);
    const notify = (): void => {
      if (this.debounce) clearTimeout(this.debounce);
      this.debounce = setTimeout(() => this.client?.onRepositoryChanged(), WATCH_DEBOUNCE_MS);
    };
    // The git dir itself covers HEAD / index / MERGE_HEAD / ORIG_HEAD; refs
    // needs its own recursive watch because branch updates land in subdirs.
    for (const [dir, recursive] of [[gitDir, false], [join(gitDir, "refs"), true]] as const) {
      try {
        this.watchers.push(
          this.watchDir(dir, recursive, () => {
            notify();
          }),
        );
      } catch {
        // Unwatchable path or permission error: degrade to the previous
        // behavior rather than failing the whole service.
      }
    }
  }

  dispose(): void {
    if (this.debounce) clearTimeout(this.debounce);
    for (const w of this.watchers) {
      try { w.close(); } catch { /* already closed */ }
    }
    this.watchers.length = 0;
  }
```

The non-recursive watch on `gitDir` already reports `HEAD`, `index`, `MERGE_HEAD` and `ORIG_HEAD`; no separate per-file watches or constant are needed.

Wire arming into `getStatus`, which every consumer already calls:

```ts
  async getStatus(root: string): Promise<GitStatusDto> {
    if (this.client && !this.armed.has(root)) {
      const gitDir = await this.resolveGitDir(root);
      if (gitDir) this.armWatch(root, gitDir);
    }
    const status = await this.git(root).status();
    /* …unchanged… */
  }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/theia-extensions && pnpm vitest run src/node/spexr-git-backend-service.test.ts -t "repository watcher"`
Expected: PASS, 3 tests.

- [ ] **Step 6: Wire the client into the backend module**

In `packages/theia-extensions/src/node/spexr-backend-module.ts`, replace the `GIT_SERVICE_PATH` binding (currently around lines 25-28) with the client-taking form already used by search and darkfactory:

```ts
  bind(ConnectionHandler)
    .toDynamicValue((ctx) => {
      const service = ctx.container.get(SpexrGitBackendService);
      return new RpcConnectionHandler<SpexrGitClient>(GIT_SERVICE_PATH, (client) => {
        service.setClient(client);
        return service;
      });
    })
    .inSingletonScope();
```

Import `SpexrGitClient` from `../common/git-protocol.js`.

- [ ] **Step 7: Typecheck, lint, full suite**

Run: `pnpm --filter @spexr/theia-extensions run typecheck && pnpm --filter @spexr/theia-extensions run lint && (cd packages/theia-extensions && pnpm test)`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/theia-extensions/src/common/git-protocol.ts packages/theia-extensions/src/node/spexr-git-backend-service.ts packages/theia-extensions/src/node/spexr-backend-module.ts packages/theia-extensions/src/node/spexr-git-backend-service.test.ts
git commit -m "feat(git): watch the git dir and push repository changes to the frontend"
```

---

### Task 4: Refresh reactively, exactly once at a time

**Implements:** AC-5, AC-6 of `docs/specs/0014-git-hardening.md`

**Files:**
- Create: `packages/theia-extensions/src/browser/scm/git-client.ts`
- Modify: `packages/theia-extensions/src/browser/scm/git-scm-provider.ts`
- Modify: `packages/theia-extensions/src/browser/spexr-frontend-module.ts`
- Test: `packages/theia-extensions/src/browser/scm/git-scm-provider.test.ts` (new)

**Interfaces:**
- Consumes: `SpexrGitClient` from Task 3
- Produces: `SpexrGitClientDispatcher` (implements `SpexrGitClient`, exposes `onRepositoryChanged$: Event<void>`) and `SpexrGitClientToken`

- [ ] **Step 1: Create the client dispatcher**

Mirroring `browser/search/smart-search-client.ts`:

```ts
import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { SpexrGitClient } from "../../common/git-protocol.js";

export const SpexrGitClientToken = Symbol("SpexrGitClientDispatcher");

/**
 * Singleton client registered on the git RPC proxy. The backend pushes here
 * whenever the repository moves on disk — including from an agent's terminal.
 */
@injectable()
export class SpexrGitClientDispatcher implements SpexrGitClient {
  private readonly emitter = new Emitter<void>();
  readonly onRepositoryChanged$: Event<void> = this.emitter.event;

  onRepositoryChanged(): void {
    this.emitter.fire();
  }
}
```

- [ ] **Step 2: Write the failing single-flight test**

Create `packages/theia-extensions/src/browser/scm/git-scm-provider.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { SingleFlight } from "./single-flight.js";

describe("SingleFlight", () => {
  it("does not start a second run while one is in flight", async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const sf = new SingleFlight(async () => { runs += 1; await gate; });

    void sf.run();
    void sf.run();
    void sf.run();
    expect(runs).toBe(1);

    release();
    await sf.settled();
    expect(runs).toBe(2); // one rerun for the requests that arrived mid-flight
  });

  it("does not rerun when nothing was requested during the run", async () => {
    let runs = 0;
    const sf = new SingleFlight(async () => { runs += 1; });
    await sf.run();
    await sf.settled();
    expect(runs).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm vitest run src/browser/scm/git-scm-provider.test.ts`
Expected: FAIL — cannot resolve `./single-flight.js`.

- [ ] **Step 4: Implement SingleFlight**

Create `packages/theia-extensions/src/browser/scm/single-flight.ts`:

```ts
/**
 * Runs an async operation at most once at a time. Calls arriving mid-flight
 * do not queue up — they mark the run dirty, and exactly one rerun follows.
 * Needed because refresh now has two independent triggers (workspace file
 * changes and repository pushes) that routinely fire together.
 */
export class SingleFlight {
  private inFlight?: Promise<void>;
  private dirty = false;

  constructor(private readonly op: () => Promise<void>) {}

  run(): Promise<void> {
    if (this.inFlight) {
      this.dirty = true;
      return this.inFlight;
    }
    this.inFlight = this.cycle();
    return this.inFlight;
  }

  /** Resolves when the current run and any rerun it triggered are done. */
  async settled(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  private async cycle(): Promise<void> {
    try {
      await this.op();
      while (this.dirty) {
        this.dirty = false;
        await this.op();
      }
    } finally {
      this.inFlight = undefined;
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/theia-extensions && pnpm vitest run src/browser/scm/git-scm-provider.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Use it in the provider and subscribe to the push channel**

In `git-scm-provider.ts`:

```ts
  @inject(SpexrGitClientToken)
  private readonly gitClient!: SpexrGitClientDispatcher;

  private readonly refresher = new SingleFlight(() => this.doRefresh());
```

Rename the existing `refresh()` body to `private async doRefresh(): Promise<void>` unchanged, and add:

```ts
  async refresh(): Promise<void> {
    await this.refresher.run();
  }
```

In `onStart`, after the existing `onDidFilesChange` subscription:

```ts
    this.toDispose.push(this.gitClient.onRepositoryChanged$(() => this.scheduleRefresh()));
```

- [ ] **Step 7: Bind in the frontend module**

In `spexr-frontend-module.ts`, in the `// --- Git SCM ---` block, before the proxy binding:

```ts
  bind(SpexrGitClientDispatcher).toSelf().inSingletonScope();
  bind(SpexrGitClientToken).toService(SpexrGitClientDispatcher);
```

and change the proxy creation to pass the client:

```ts
  bind(SpexrGitServiceProxySymbol)
    .toDynamicValue((ctx) => {
      const connection = ctx.container.get(WebSocketConnectionProvider);
      const client = ctx.container.get(SpexrGitClientDispatcher);
      return connection.createProxy(GIT_SERVICE_PATH, client);
    })
    .inSingletonScope();
```

- [ ] **Step 8: Typecheck, lint, full suite, then verify by hand**

Run: `pnpm --filter @spexr/theia-extensions run typecheck && pnpm --filter @spexr/theia-extensions run lint && (cd packages/theia-extensions && pnpm test)`

Then `pnpm dev`, open a repository, and in the embedded terminal run `git add <file>`. The file must move to "Staged Changes" with no further interaction. Then `git commit` — the staged group must empty. This is the acceptance moment for the whole slice.

- [ ] **Step 9: Commit**

```bash
git add packages/theia-extensions/src/browser/scm/ packages/theia-extensions/src/browser/spexr-frontend-module.ts
git commit -m "feat(git): refresh the SCM panel on external repository changes"
```

---

## Slice 2 — Per-file staging

### Task 5: Send repository-relative paths

**Implements:** AC-7 of `docs/specs/0014-git-hardening.md`

**Files:**
- Modify: `packages/theia-extensions/src/browser/scm/git-scm-provider.ts`
- Modify: `packages/theia-extensions/src/browser/scm/git-commands-contribution.ts`
- Test: `packages/theia-extensions/src/browser/scm/relative-path.test.ts` (new)

**Interfaces:**
- Produces: `export function toRepoRelative(root: string, fsPath: string): string` in `browser/scm/relative-path.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { toRepoRelative } from "./relative-path.js";

describe("toRepoRelative", () => {
  it("strips the root prefix", () => {
    expect(toRepoRelative("/w/repo", "/w/repo/src/a.ts")).toBe("src/a.ts");
  });
  it("leaves an already-relative path alone", () => {
    expect(toRepoRelative("/w/repo", "src/a.ts")).toBe("src/a.ts");
  });
  it("handles the root itself", () => {
    expect(toRepoRelative("/w/repo", "/w/repo")).toBe("");
  });
  it("does not strip a sibling directory that merely shares a prefix", () => {
    expect(toRepoRelative("/w/repo", "/w/repo-other/a.ts")).toBe("/w/repo-other/a.ts");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm vitest run src/browser/scm/relative-path.test.ts`
Expected: FAIL — cannot resolve `./relative-path.js`.

- [ ] **Step 3: Implement**

Create `packages/theia-extensions/src/browser/scm/relative-path.ts`:

```ts
/**
 * Path relative to the repository root, which is what git commands expect.
 * The panel holds absolute filesystem URIs; passing those to `git add` only
 * happened to work because simple-git runs with cwd at the root.
 */
export function toRepoRelative(root: string, fsPath: string): string {
  if (!fsPath.startsWith("/")) return fsPath;
  const base = root.endsWith("/") ? root : `${root}/`;
  if (fsPath === root) return "";
  // The trailing separator check prevents /w/repo matching /w/repo-other.
  return fsPath.startsWith(base) ? fsPath.slice(base.length) : fsPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/theia-extensions && pnpm vitest run src/browser/scm/relative-path.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Apply it at both call sites**

Add the accessor to `git-scm-provider.ts`:

```ts
  /** Filesystem path of the repository root, or undefined outside a workspace. */
  get root(): string | undefined {
    return this.rootFsPath;
  }
```

Then in `git-commands-contribution.ts`, `stageAll` and `unstageAll` currently map `r.sourceUri.path.toString()` straight into the service call. Route each through the converter:

```ts
  private async stageAll(): Promise<void> {
    const root = this.provider.root;
    if (!root) return;
    const paths = this.provider.groups
      .find((g) => g.id === "workingTree")
      ?.resources.map((r) => toRepoRelative(root, r.sourceUri.path.toString())) ?? [];
    if (paths.length === 0) return;
    await this.provider.stage(paths);
  }
```

Apply the same shape to `unstageAll`, reading the `index` group. Import `toRepoRelative` from `./relative-path.js`.

- [ ] **Step 6: Full suite and commit**

```bash
cd packages/theia-extensions && pnpm test
git add packages/theia-extensions/src/browser/scm/
git commit -m "fix(git): send repository-relative paths to git, not absolute ones"
```

---

### Task 6: Discard changes

**Implements:** AC-8 of `docs/specs/0014-git-hardening.md`

**Files:**
- Modify: `packages/theia-extensions/src/common/git-protocol.ts`
- Modify: `packages/theia-extensions/src/node/spexr-git-backend-service.ts`
- Test: `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`

**Interfaces:**
- Produces: `discard(root: string, paths: string[]): Promise<void>` on `SpexrGitService`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm vitest run src/node/spexr-git-backend-service.test.ts -t "discard"`
Expected: FAIL — `service.discard is not a function`.

- [ ] **Step 3: Add the protocol method**

In `common/git-protocol.ts`, inside `SpexrGitService`, after `unstage`:

```ts
  /**
   * Throw away working-tree changes. Tracked paths are restored from HEAD;
   * untracked paths are deleted from disk. Irreversible — callers confirm first.
   */
  discard(root: string, paths: string[]): Promise<void>;
```

- [ ] **Step 4: Implement**

```ts
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
```

Add `rm` to the `node:fs/promises` import.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd packages/theia-extensions && pnpm vitest run src/node/spexr-git-backend-service.test.ts -t "discard"`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/common/git-protocol.ts packages/theia-extensions/src/node/spexr-git-backend-service.ts packages/theia-extensions/src/node/spexr-git-backend-service.test.ts
git commit -m "feat(git): discard working-tree changes for tracked and untracked paths"
```

---

### Task 7: Per-file commands, menus, and the discard confirmation

**Implements:** AC-9, AC-10 of `docs/specs/0014-git-hardening.md`

**Files:**
- Modify: `packages/theia-extensions/src/browser/scm/git-commands-contribution.ts`
- Modify: `packages/theia-extensions/src/browser/scm/git-scm-provider.ts`
- Modify: `packages/theia-extensions/src/browser/spexr-frontend-module.ts`

**Interfaces:**
- Consumes: `discard` from Task 6, `toRepoRelative` from Task 5
- Produces: commands `spexr.git.stageFile`, `spexr.git.unstageFile`, `spexr.git.discardFile`

- [ ] **Step 1: Add the commands**

In the `GitCommands` object:

```ts
  STAGE_FILE: { id: "spexr.git.stageFile", label: "Git: Stage File" } satisfies Command,
  UNSTAGE_FILE: { id: "spexr.git.unstageFile", label: "Git: Unstage File" } satisfies Command,
  DISCARD_FILE: { id: "spexr.git.discardFile", label: "Git: Discard File Changes" } satisfies Command,
```

- [ ] **Step 2: Add a `discard` passthrough on the provider**

```ts
  async discard(paths: string[]): Promise<void> {
    if (!this.rootFsPath) return;
    await this.gitService.discard(this.rootFsPath, paths);
    await this.refresh();
  }
```

- [ ] **Step 3: Register the command handlers**

The SCM tree passes the selected resource as the command argument. Resolve its path, then act:

```ts
    commands.registerCommand(GitCommands.STAGE_FILE, {
      execute: (arg: unknown) =>
        this.runGitOp("Stage file", () => this.provider.stage(this.pathsOf(arg))),
    });
    commands.registerCommand(GitCommands.UNSTAGE_FILE, {
      execute: (arg: unknown) =>
        this.runGitOp("Unstage file", () => this.provider.unstage(this.pathsOf(arg))),
    });
    commands.registerCommand(GitCommands.DISCARD_FILE, {
      execute: (arg: unknown) => this.discardWithConfirm(this.pathsOf(arg)),
    });
```

with:

```ts
  /** Repository-relative paths for the SCM rows the command was invoked on. */
  private pathsOf(arg: unknown): string[] {
    const root = this.provider.root;
    if (!root) return [];
    const items = Array.isArray(arg) ? arg : [arg];
    return items
      .map((i) => (i as { sourceUri?: { path?: { toString(): string } } })?.sourceUri?.path?.toString())
      .filter((p): p is string => typeof p === "string")
      .map((p) => toRepoRelative(root, p));
  }

  private async discardWithConfirm(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const listed = paths.length <= 5
      ? paths.join("\n")
      : `${paths.slice(0, 5).join("\n")}\n…and ${paths.length - 5} more`;
    const ok = await new ConfirmDialog({
      title: paths.length === 1 ? "Discard changes" : `Discard changes in ${paths.length} files`,
      msg: `${listed}\n\nChanges will be lost. This cannot be undone.`,
      ok: "Discard",
      cancel: "Cancel",
    }).open();
    if (!ok) return;
    await this.runGitOp("Discard changes", () => this.provider.discard(paths), "Changes discarded.");
  }
```

Import: `import { ConfirmDialog } from "@theia/core/lib/browser";`

- [ ] **Step 4: Register the menus**

Make the contribution implement `MenuContribution` and register on the SCM resource menus:

```ts
import { ScmTreeWidget } from "@theia/scm/lib/browser/scm-tree-widget";

  registerMenus(menus: MenuModelRegistry): void {
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_INLINE_MENU, {
      commandId: GitCommands.STAGE_FILE.id, label: "Stage", icon: "codicon codicon-add", order: "1",
    });
    menus.registerMenuAction(ScmTreeWidget.RESOURCE_INLINE_MENU, {
      commandId: GitCommands.DISCARD_FILE.id, label: "Discard", icon: "codicon codicon-discard", order: "2",
    });
    for (const cmd of [GitCommands.STAGE_FILE, GitCommands.UNSTAGE_FILE, GitCommands.DISCARD_FILE]) {
      menus.registerMenuAction(ScmTreeWidget.RESOURCE_CONTEXT_MENU, { commandId: cmd.id, label: cmd.label });
    }
  }
```

Bind it in `spexr-frontend-module.ts`: `bind(MenuContribution).toService(SpexrGitCommandsContribution);`

- [ ] **Step 5: Typecheck, lint, full suite, manual check**

Run the standard command trio, then `pnpm dev`: modify two files, stage one from its row, discard the other and confirm the dialog names it. Cancelling must leave the file untouched.

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/browser/
git commit -m "feat(git): per-file stage, unstage and discard with confirmation"
```

---

## Slice 3 — Upstream-aware push and branch indicator

### Task 8: Push sets upstream; getBranches reports it

**Implements:** AC-11, AC-12 of `docs/specs/0014-git-hardening.md`

**Files:**
- Modify: `packages/theia-extensions/src/node/spexr-git-backend-service.ts`
- Test: `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`

**Interfaces:**
- Produces: `pickRemote(remotes: string[]): string` exported for unit testing

- [ ] **Step 1: Write the failing tests**

```ts
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

  await service.push(tmpDir);   // must not throw despite no upstream

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/theia-extensions && pnpm vitest run src/node/spexr-git-backend-service.test.ts -t "pickRemote"`
Expected: FAIL — `pickRemote` is not exported. The push test fails with git's "no upstream branch" error.

- [ ] **Step 3: Implement**

```ts
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
```

and replace `push`:

```ts
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
```

For `getBranches`, populate `upstream` from simple-git's per-branch `label`/tracking data:

```ts
  async getBranches(root: string): Promise<GitBranchDto[]> {
    const result = await this.git(root).branch(["-a", "-vv"]);
    return Object.values(result.branches).map((b) => {
      // `-vv` renders tracking as "[origin/main]" or "[origin/main: ahead 1]".
      const tracking = /\[([^\]:]+)(?::[^\]]*)?\]/.exec(b.label ?? "")?.[1];
      return {
        name: b.name,
        isCurrent: b.current,
        isRemote: b.name.startsWith("remotes/"),
        ...(tracking && { upstream: tracking }),
      };
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/theia-extensions && pnpm vitest run src/node/spexr-git-backend-service.test.ts -t "push:|getBranches:|pickRemote"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/spexr-git-backend-service.ts packages/theia-extensions/src/node/spexr-git-backend-service.test.ts
git commit -m "fix(git): set upstream on the first push of a new branch"
```

---

### Task 9: Status-bar branch indicator, and remove getDiff

**Implements:** AC-13, AC-14 of `docs/specs/0014-git-hardening.md`

**Files:**
- Create: `packages/theia-extensions/src/browser/scm/git-status-bar-contribution.ts`
- Modify: `packages/theia-extensions/src/browser/scm/git-scm-provider.ts`
- Modify: `packages/theia-extensions/src/browser/spexr-frontend-module.ts`
- Modify: `packages/theia-extensions/src/common/git-protocol.ts`
- Modify: `packages/theia-extensions/src/node/spexr-git-backend-service.ts`
- Modify: `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`

**Interfaces:**
- Consumes: `GitStatusDto` from the provider
- Produces: `onDidChangeStatus: Event<GitStatusDto>` on `SpexrGitScmProvider`

- [ ] **Step 1: Emit status from the provider**

In `git-scm-provider.ts`:

```ts
  private readonly _onDidChangeStatusEmitter = new Emitter<GitStatusDto>();
  /** Last known status, so consumers need not spawn their own git process. */
  readonly onDidChangeStatus: Event<GitStatusDto> = this._onDidChangeStatusEmitter.event;
```

In `doRefresh`, right after `const status = await this.gitService.getStatus(...)`:

```ts
      this._onDidChangeStatusEmitter.fire(status);
```

Dispose it alongside the other emitters.

- [ ] **Step 2: Write the failing formatter test**

Create `packages/theia-extensions/src/browser/scm/git-status-bar-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatBranchEntry } from "./git-status-bar-format.js";

describe("formatBranchEntry", () => {
  it("shows just the branch when in sync", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 0, behind: 0 })).toBe("$(git-branch) main");
  });
  it("shows ahead only", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 2, behind: 0 })).toBe("$(git-branch) main ↑2");
  });
  it("shows behind only", () => {
    expect(formatBranchEntry({ branch: "main", ahead: 0, behind: 3 })).toBe("$(git-branch) main ↓3");
  });
  it("shows both, ahead first", () => {
    expect(formatBranchEntry({ branch: "dev", ahead: 2, behind: 3 })).toBe("$(git-branch) dev ↑2↓3");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm vitest run src/browser/scm/git-status-bar-format.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the formatter**

Create `packages/theia-extensions/src/browser/scm/git-status-bar-format.ts`:

```ts
/** Branch plus divergence, e.g. "$(git-branch) main ↑2↓3". */
export function formatBranchEntry(s: { branch: string; ahead: number; behind: number }): string {
  const arrows = `${s.ahead > 0 ? `↑${s.ahead}` : ""}${s.behind > 0 ? `↓${s.behind}` : ""}`;
  return `$(git-branch) ${s.branch}${arrows ? ` ${arrows}` : ""}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/theia-extensions && pnpm vitest run src/browser/scm/git-status-bar-format.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Add the contribution**

Create `git-status-bar-contribution.ts`, following `description-job-status-bar-contribution.ts`:

```ts
import { inject, injectable } from "@theia/core/shared/inversify";
import { type FrontendApplicationContribution } from "@theia/core/lib/browser";
import { StatusBar, StatusBarAlignment } from "@theia/core/lib/browser/status-bar/status-bar";
import { SpexrGitScmProvider } from "./git-scm-provider.js";
import { GitCommands } from "./git-commands-contribution.js";
import { formatBranchEntry } from "./git-status-bar-format.js";

const ENTRY_ID = "spexr-git-branch";

/** Current branch and divergence from upstream; click opens the checkout picker. */
@injectable()
export class GitStatusBarContribution implements FrontendApplicationContribution {
  @inject(StatusBar) private readonly statusBar!: StatusBar;
  @inject(SpexrGitScmProvider) private readonly provider!: SpexrGitScmProvider;

  onStart(): void {
    this.provider.onDidChangeStatus((s) => {
      void this.statusBar.setElement(ENTRY_ID, {
        text: formatBranchEntry(s),
        alignment: StatusBarAlignment.LEFT,
        priority: 200,
        tooltip: s.upstream ? `Tracking ${s.upstream}` : "No upstream branch",
        command: GitCommands.CHECKOUT.id,
      });
    });
  }
}
```

Bind it in `spexr-frontend-module.ts`:

```ts
  bind(GitStatusBarContribution).toSelf().inSingletonScope();
  bind(FrontendApplicationContribution).toService(GitStatusBarContribution);
```

- [ ] **Step 7: Remove `getDiff`**

Delete the method from `common/git-protocol.ts` and from `spexr-git-backend-service.ts`, and delete its two tests (`"getDiff: returns diff for unstaged modification"` and `"getDiff: returns diff for staged modification"`, currently at lines 99 and 106 of the test file). It has no caller — the diff editor uses `getFileAtRevision`. Leave `getLog` in place: it is the seam a later history view consumes, and spec AC-14 records that asymmetry deliberately.

- [ ] **Step 8: Typecheck, lint, full suite, manual check**

Run the standard trio. Then `pnpm dev`: the status bar shows the branch; commit without pushing and it gains `↑1`; clicking it opens the checkout picker.

- [ ] **Step 9: Commit**

```bash
git add packages/theia-extensions/src/
git commit -m "feat(git): status-bar branch indicator with ahead/behind; drop unused getDiff"
```

---

## Slice 4 — Conflicts surfaced

### Task 10: Separate untracked from unmerged, and detect conflicts

**Implements:** AC-15, AC-16 of `docs/specs/0014-git-hardening.md`

**Files:**
- Modify: `packages/theia-extensions/src/common/git-protocol.ts`
- Modify: `packages/theia-extensions/src/node/spexr-git-backend-service.ts`
- Modify: `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`

**Interfaces:**
- Produces: `GitFileState = "A" | "M" | "D" | "R" | "C" | "U" | "?"` where `"U"` means unmerged and `"?"` means untracked; `mapFileChange` exported for unit tests.

- [ ] **Step 1: Write the failing tests**

```ts
describe("mapFileChange — conflict and untracked states", () => {
  it("marks untracked with ?, not U", () => {
    expect(mapFileChange("new.txt", "?", "?")).toEqual({ path: "new.txt", unstagedState: "?" });
  });

  it.each([["U","U"],["A","A"],["D","D"],["A","U"],["U","A"],["D","U"],["U","D"]])(
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
```

Update the existing assertion in `"getStatus: detects untracked file"` from `expect(f!.unstagedState).toBe("U")` to `expect(f!.unstagedState).toBe("?")` — the letter's meaning changed, and this is the test that pins it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/theia-extensions && pnpm vitest run src/node/spexr-git-backend-service.test.ts -t "mapFileChange"`
Expected: FAIL — `mapFileChange` is not exported; untracked still yields `"U"`.

- [ ] **Step 3: Change the protocol**

```ts
/**
 * `?` untracked · `U` unmerged (conflict) · the rest are git's own index
 * letters. These two were previously conflated: untracked was reported as `U`
 * while git's unmerged `U` was folded into `C`.
 */
export type GitFileState = "A" | "M" | "D" | "R" | "C" | "U" | "?";
```

- [ ] **Step 4: Implement the mapping**

```ts
/** Index/worktree pairs git uses for an unmerged path. */
const CONFLICT_PAIRS = new Set(["UU", "AA", "DD", "AU", "UA", "DU", "UD"]);

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
```

and drop the `case "U": return "C";` line from `mapStateChar` — unmerged no longer reaches it.

- [ ] **Step 5: Update the frontend letter maps**

In `git-scm-provider.ts`, extend `STATE_LETTER` and `stateLabel` with `"?": "U"` / `"Untracked"` and `"U": "!"` / `"Conflicted"`. TypeScript will flag both `Record<GitFileState, string>` maps until every member is present — follow the compiler.

- [ ] **Step 6: Run the full suite**

Run: `cd packages/theia-extensions && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/theia-extensions/src/
git commit -m "fix(git): stop conflating untracked and unmerged file states"
```

---

### Task 11: Conflict group and mark-resolved

**Implements:** AC-17, AC-18 of `docs/specs/0014-git-hardening.md`

**Files:**
- Modify: `packages/theia-extensions/src/browser/scm/git-scm-provider.ts`
- Modify: `packages/theia-extensions/src/browser/scm/git-commands-contribution.ts`

**Interfaces:**
- Consumes: the `"U"` unmerged state from Task 10

- [ ] **Step 1: Add the group**

```ts
  private readonly conflictGroup = new GitScmResourceGroup(
    "conflicts", "Merge Conflicts", this as unknown as ScmProvider,
  );
```

Set `hideWhenEmpty = true` on it after construction (the other two stay `false`), and order it first:

```ts
  get groups(): ScmResourceGroup[] {
    return [this.conflictGroup, this.indexGroup, this.workingTreeGroup];
  }
```

- [ ] **Step 2: Route conflicted files into it**

In `doRefresh`, before computing `staged` and `unstaged`:

```ts
      const conflicted = status.files.filter((f) => f.unstagedState === "U");
      const conflictPaths = new Set(conflicted.map((f) => f.path));
```

Build the conflict resources the same way the other groups are built, opening the file directly rather than a diff (a conflicted file has no single "original" side). Then exclude those paths from both other groups so a conflict appears exactly once:

```ts
      const staged = status.files
        .filter((f) => f.stagedState !== undefined && !conflictPaths.has(f.path))
        /* …unchanged… */
      const unstaged = status.files
        .filter((f) => f.unstagedState !== undefined && f.unstagedState !== "U")
        /* …unchanged… */
```

Update `this.conflictGroup.updateResources(...)` alongside the other two, and dispose it with them.

- [ ] **Step 3: Add mark-resolved**

```ts
  MARK_RESOLVED: { id: "spexr.git.markResolved", label: "Git: Mark Conflict Resolved" } satisfies Command,
```

```ts
    commands.registerCommand(GitCommands.MARK_RESOLVED, {
      execute: (arg: unknown) =>
        // Staging IS resolution, in git's own terms.
        this.runGitOp("Mark resolved", () => this.provider.stage(this.pathsOf(arg)), "Marked resolved."),
    });
```

Register it on `ScmTreeWidget.RESOURCE_CONTEXT_MENU` and as an inline action.

- [ ] **Step 4: Typecheck, lint, full suite, manual check**

Run the standard trio. Then produce a real conflict in a scratch repository (`git merge` two divergent branches touching one file), open it in SPEXR, and confirm: the file appears under "Merge Conflicts" and nowhere else, and mark-resolved moves it to "Staged Changes".

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/browser/scm/
git commit -m "feat(git): surface merge conflicts in their own group with mark-resolved"
```

---

## Wrap-up

- [ ] **Update the spec status:** in `docs/specs/0014-git-hardening.md`, set `status: complete` and `updatedAt` to the merge date.
- [ ] **Full verification:** `pnpm --filter @spexr/theia-extensions run typecheck && pnpm --filter @spexr/theia-extensions run lint && (cd packages/theia-extensions && pnpm test)`.
- [ ] **Open the pull request** against `main`, listing the acceptance criteria and noting that root `pnpm test` remains red for the pre-existing reasons in https://github.com/sondalab-ai/spexr-ide/issues/13.
