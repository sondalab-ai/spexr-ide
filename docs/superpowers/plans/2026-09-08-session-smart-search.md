# Session Smart Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Find any past agent session by describing it in natural language, from a query bar on the Darkfactory wall, including sessions far outside the sixty the wall renders.

**Architecture:** A global session index (one document and one 384-dimension vector per session) is built incrementally in the backend process and persisted to `~/.spexr/sessions-index.json`. Queries score hybrid — `0.65 * cosine + 0.35 * normalizedBM25` — reusing the code search's BM25 index, query expander, and vector math. Results come back as full `AgentTile` objects so the wall renders them with its existing cards; sessions outside the current scan are parsed on demand and tracked in a search-owned metadata map, because the scan-owned one is cleared every poll.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Theia 1.75 RPC (`ConnectionHandler` / `RpcConnectionHandler`), Inversify DI, React 19 class-based `ReactWidget`, `@huggingface/transformers` ONNX embedder (`Xenova/all-MiniLM-L6-v2`, 384 dims), Vitest.

**Spec:** `docs/specs/0015-session-smart-search.md`

## Global Constraints

- **Package:** all code lives in `packages/theia-extensions`. Run commands from the repo root.
- **Imports:** ESM with explicit `.js` extensions on relative imports (`./session-index.js`), even from `.ts` sources.
- **Tests:** Vitest, colocated as `<module>.test.ts` next to the module. Run one file with `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/<file>.test.ts`.
- **Validation after each task:** `pnpm --filter @spexr/theia-extensions run typecheck && pnpm --filter @spexr/theia-extensions run lint && pnpm --filter @spexr/theia-extensions test`.
- **Browser/Node split:** `src/browser/**` must never import a Node-only module. `src/common/**` must stay free of `node:` imports.
- **Index version:** `SESSION_INDEX_VERSION = 1`. Never reuse or touch the code index's `INDEX_VERSION` (currently 8, in `src/node/search/vector-index.ts`).
- **Scoring constants (verbatim from the spec):** dense weight `0.65`, BM25 weight `0.35`, dense candidate floor `0.05`, BM25 relative cut `0.3`, minimum hybrid score `0.18`, `TOP_K = 24`.
- **Crawl budget:** embed batch 16, parse concurrency 8, first crawl starts 10 s after backend startup, index persisted at most once per 5 s during a crawl.
- **Comments:** only non-obvious _why_. New exported functions get roughly four lines of doc comment, matching the surrounding files.

---

### Task 1: Session document builder

**Files:**

- Create: `packages/theia-extensions/src/node/darkfactory/session-doc.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/session-doc.test.ts`

**Interfaces:**

- Consumes: `TurnEntry` from `./turns.js`; `sessionGoal`, `recentAssistantProse` from `./turns.js`.
- Produces: `buildSessionDoc(input: SessionDocInput): string`, `toolTargets(entries: TurnEntry[]): string[]`, `projectTail(projectPath: string): string`, `SessionDocInput`.

- [ ] **Step 1: Write the failing test**

Create `packages/theia-extensions/src/node/darkfactory/session-doc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSessionDoc, projectTail, toolTargets } from "./session-doc.js";

describe("projectTail", () => {
  it("keeps the last two segments so sibling projects stay distinguishable", () => {
    expect(projectTail("/Users/me/src/mine/spexr")).toBe("mine/spexr");
    expect(projectTail("/spexr")).toBe("spexr");
    expect(projectTail("")).toBe("");
  });
});

describe("toolTargets", () => {
  it("collects file paths, patterns and the leading word of commands, deduplicated in order", () => {
    const entries = [
      {
        message: {
          role: "assistant",
          content: [
            { type: "tool_use", name: "Edit", input: { file_path: "/p/src/theme.css" } },
            { type: "tool_use", name: "Bash", input: { command: "pnpm test --filter ui" } },
            { type: "tool_use", name: "Grep", input: { pattern: "--color-accent" } },
            { type: "tool_use", name: "Edit", input: { file_path: "/p/src/theme.css" } },
          ],
        },
      },
    ];
    expect(toolTargets(entries)).toEqual(["/p/src/theme.css", "pnpm", "--color-accent"]);
  });

  it("ignores messages without tool_use blocks", () => {
    expect(toolTargets([{ message: { role: "user", content: "hello" } }])).toEqual([]);
  });
});

describe("buildSessionDoc", () => {
  it("puts the goal first and the project, branch, prose and targets after it", () => {
    const doc = buildSessionDoc({
      projectPath: "/Users/me/src/mine/spexr",
      gitBranch: "feat/effects",
      goal: "add new effects to the design system",
      prose: ["Added a glow token", "Wired the hover transition"],
      targets: ["/p/src/theme.css", "pnpm"],
    });
    expect(doc.startsWith("add new effects to the design system")).toBe(true);
    expect(doc).toContain("spexr");
    expect(doc).toContain("mine/spexr");
    expect(doc).toContain("feat/effects");
    expect(doc).toContain("Added a glow token");
    expect(doc).toContain("/p/src/theme.css");
  });

  it("caps the document at 4000 characters, dropping targets before the goal", () => {
    const doc = buildSessionDoc({
      projectPath: "/p/spexr",
      goal: "G".repeat(500),
      prose: ["P".repeat(3600)],
      targets: Array.from({ length: 500 }, (_, i) => `/p/file-${i}.ts`),
    });
    expect(doc.length).toBe(4000);
    expect(doc.startsWith("G".repeat(500))).toBe(true);
    expect(doc).not.toContain("/p/file-39.ts");
  });

  it("tolerates an empty session", () => {
    expect(buildSessionDoc({ projectPath: "", goal: "", prose: [], targets: [] })).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/session-doc.test.ts`
Expected: FAIL — cannot resolve `./session-doc.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/theia-extensions/src/node/darkfactory/session-doc.ts`:

```ts
import { basename, sep } from "node:path";
import type { TurnEntry } from "./turns.js";

/** Everything one session contributes to its indexable document. */
export interface SessionDocInput {
  projectPath: string;
  gitBranch?: string;
  goal: string;
  prose: string[];
  targets: string[];
}

/**
 * Document cap. Long enough to hold a goal, several prose segments and a real
 * spread of touched files; short enough that a thousand of them stay a few
 * megabytes on disk.
 */
const MAX_DOC_CHARS = 4000;
/** Tool targets kept per session — beyond this they stop identifying the work. */
const MAX_TARGETS = 40;

/**
 * The last two segments of a project path (`…/src/mine/spexr` → `mine/spexr`).
 * The parent segment is what tells two same-named checkouts apart.
 */
export function projectTail(projectPath: string): string {
  const parts = projectPath.split(sep).filter(Boolean);
  return parts.slice(-2).join("/");
}

/**
 * The distinct things a session acted on: file paths, search patterns, and the
 * leading word of each shell command. These carry the literal terms — file
 * names, tool names — that the lexical half of the hybrid score matches on.
 */
export function toolTargets(entries: TurnEntry[]): string[] {
  const seen = new Set<string>();
  for (const entry of entries) {
    const content = entry.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      const b = block as { type?: string; input?: Record<string, unknown> };
      if (b.type !== "tool_use" || !b.input) continue;
      const path = b.input["file_path"];
      const pattern = b.input["pattern"];
      const command = b.input["command"];
      if (typeof path === "string" && path) seen.add(path);
      if (typeof pattern === "string" && pattern) seen.add(pattern);
      if (typeof command === "string" && command.trim()) seen.add(command.trim().split(/\s+/)[0]!);
    }
  }
  return [...seen];
}

/**
 * Build the text that represents one session in the index. The goal leads, so a
 * document hitting the cap loses tool targets rather than the sentence that
 * identifies the session.
 */
export function buildSessionDoc(input: SessionDocInput): string {
  const parts = [
    input.goal.trim(),
    basename(input.projectPath),
    projectTail(input.projectPath),
    input.gitBranch?.trim() ?? "",
    ...input.prose.map((p) => p.trim()),
    input.targets.slice(0, MAX_TARGETS).join(" "),
  ].filter(Boolean);
  return parts.join("\n").slice(0, MAX_DOC_CHARS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/session-doc.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/session-doc.ts packages/theia-extensions/src/node/darkfactory/session-doc.test.ts
git commit -m "feat(darkfactory): build one indexable document per session"
```

---

### Task 2: Session index

**Files:**

- Create: `packages/theia-extensions/src/node/darkfactory/session-index.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/session-index.test.ts`

**Interfaces:**

- Consumes: `BM25Index` from `../search/bm25-index.js`; `cosineSimilarity`, `topKIndices` from `../search/vector-math.js`; `HarnessId` from `../../common/harness/harness-types.js`.
- Produces: `SESSION_INDEX_VERSION`, `SessionRecord`, `SessionVectorHit`, `SerializedSessionIndex`, and the `SessionIndex` class with `size`, `bm25`, `upsert`, `remove`, `isCurrent`, `get`, `ids`, `searchDense`, `toJSON`, `static fromJSON`.

- [ ] **Step 1: Write the failing test**

Create `packages/theia-extensions/src/node/darkfactory/session-index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SessionIndex, SESSION_INDEX_VERSION, type SessionRecord } from "./session-index.js";

function record(id: string, vector: number[], doc: string): SessionRecord {
  return {
    sessionId: id,
    harness: "claude",
    projectPath: `/p/${id}`,
    projectName: id,
    transcriptPath: `/t/${id}.jsonl`,
    configDir: "/home/.claude",
    mtimeMs: 1000,
    docHash: `h-${id}`,
    vector: Float32Array.from(vector),
    goal: `goal ${id}`,
    doc,
  };
}

describe("SessionIndex", () => {
  it("upserts into both the vector store and the BM25 store", () => {
    const index = new SessionIndex();
    index.upsert(record("a", [1, 0], "design system effects"));
    expect(index.size).toBe(1);
    expect(index.bm25.size).toBe(1);
    expect([...index.bm25.score("effects").keys()]).toEqual(["a"]);
  });

  it("removes from both stores", () => {
    const index = new SessionIndex();
    index.upsert(record("a", [1, 0], "design system effects"));
    expect(index.remove("a")).toBe(true);
    expect(index.size).toBe(0);
    expect(index.bm25.size).toBe(0);
    expect(index.remove("a")).toBe(false);
  });

  it("reports a session as current only when its mtime is unchanged", () => {
    const index = new SessionIndex();
    index.upsert(record("a", [1, 0], "x"));
    expect(index.isCurrent("a", 1000)).toBe(true);
    expect(index.isCurrent("a", 2000)).toBe(false);
    expect(index.isCurrent("missing", 1000)).toBe(false);
  });

  it("ranks dense hits by cosine similarity, honouring k and the floor", () => {
    const index = new SessionIndex();
    index.upsert(record("near", [1, 0], "x"));
    index.upsert(record("far", [0, 1], "y"));
    const hits = index.searchDense(Float32Array.from([1, 0]), 5, 0.05);
    expect(hits.map((h) => h.sessionId)).toEqual(["near"]);
    expect(hits[0]!.score).toBeCloseTo(1, 5);
  });

  it("round-trips through JSON, rebuilding the BM25 store from the documents", () => {
    const index = new SessionIndex();
    index.upsert(record("a", [1, 0], "design system effects"));
    const restored = SessionIndex.fromJSON(JSON.parse(JSON.stringify(index.toJSON())));
    expect(restored.size).toBe(1);
    expect(restored.get("a")!.vector).toEqual(Float32Array.from([1, 0]));
    expect([...restored.bm25.score("effects").keys()]).toEqual(["a"]);
  });

  it("returns an empty index for a foreign version or a malformed payload", () => {
    expect(SessionIndex.fromJSON({ version: SESSION_INDEX_VERSION + 1, records: [] }).size).toBe(0);
    expect(SessionIndex.fromJSON({ version: SESSION_INDEX_VERSION }).size).toBe(0);
    expect(SessionIndex.fromJSON(null).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/session-index.test.ts`
Expected: FAIL — cannot resolve `./session-index.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/theia-extensions/src/node/darkfactory/session-index.ts`:

```ts
import { BM25Index } from "../search/bm25-index.js";
import { cosineSimilarity, topKIndices } from "../search/vector-math.js";
import type { HarnessId } from "../../common/harness/harness-types.js";

/**
 * Deliberately independent of the code index's `INDEX_VERSION`: the two indexes
 * hold different things in different places, and sharing a version would force a
 * full code reindex on every session-index change.
 */
export const SESSION_INDEX_VERSION = 1;

/** One indexed session: what it takes to score it, render it, and open it. */
export interface SessionRecord {
  sessionId: string;
  harness: HarnessId;
  projectPath: string;
  projectName: string;
  /** Claude only; empty for opencode, whose transcript comes from the CLI. */
  transcriptPath: string;
  /** Claude config dir owning the session; empty for opencode. */
  configDir: string;
  mtimeMs: number;
  docHash: string;
  vector: Float32Array;
  goal: string;
  doc: string;
}

/** One dense-pass result before the lexical half is blended in. */
export interface SessionVectorHit {
  sessionId: string;
  score: number;
}

interface SerializedSessionRecord extends Omit<SessionRecord, "vector"> {
  vector: number[];
}

export interface SerializedSessionIndex {
  version: number;
  records: SerializedSessionRecord[];
}

/**
 * The session store: one vector and one BM25 document per session, kept in step
 * so a session is either in both halves of the hybrid score or in neither.
 */
export class SessionIndex {
  private readonly records = new Map<string, SessionRecord>();
  readonly bm25 = new BM25Index();

  get size(): number {
    return this.records.size;
  }

  upsert(record: SessionRecord): void {
    this.records.set(record.sessionId, record);
    this.bm25.upsert(record.sessionId, record.doc);
  }

  remove(sessionId: string): boolean {
    this.bm25.remove(sessionId);
    return this.records.delete(sessionId);
  }

  /** True when the stored record already reflects this session's mtime. */
  isCurrent(sessionId: string, mtimeMs: number): boolean {
    return this.records.get(sessionId)?.mtimeMs === mtimeMs;
  }

  get(sessionId: string): SessionRecord | undefined {
    return this.records.get(sessionId);
  }

  ids(): string[] {
    return [...this.records.keys()];
  }

  searchDense(queryVector: Float32Array, k: number, minScore: number): SessionVectorHit[] {
    const records = [...this.records.values()];
    const scores = records.map((r) => cosineSimilarity(queryVector, r.vector));
    return topKIndices(scores, k, minScore).map((i) => ({
      sessionId: records[i]!.sessionId,
      score: scores[i]!,
    }));
  }

  toJSON(): SerializedSessionIndex {
    return {
      version: SESSION_INDEX_VERSION,
      records: [...this.records.values()].map((r) => ({ ...r, vector: Array.from(r.vector) })),
    };
  }

  /**
   * Rebuild from serialized data; an unknown version or a malformed payload
   * yields an empty index, which the crawl then refills. The BM25 store is
   * rebuilt from each record's document rather than serialized separately, so
   * the two halves cannot drift apart on disk.
   */
  static fromJSON(data: unknown): SessionIndex {
    const index = new SessionIndex();
    const doc = data as SerializedSessionIndex | null;
    if (!doc || typeof doc !== "object") return index;
    if (doc.version !== SESSION_INDEX_VERSION || !Array.isArray(doc.records)) return index;
    for (const r of doc.records) {
      index.upsert({ ...r, vector: new Float32Array(r.vector) });
    }
    return index;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/session-index.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/session-index.ts packages/theia-extensions/src/node/darkfactory/session-index.test.ts
git commit -m "feat(darkfactory): add the session vector and lexical index"
```

---

### Task 3: Index persistence

**Files:**

- Create: `packages/theia-extensions/src/node/darkfactory/session-index-store.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/session-index-store.test.ts`

**Interfaces:**

- Consumes: `SessionIndex`, `SESSION_INDEX_VERSION` from `./session-index.js`.
- Produces: `resolveSessionIndexPath(env?: NodeJS.ProcessEnv): string`, `loadSessionIndex(path?: string): Promise<SessionIndex>`, `saveSessionIndex(index: SessionIndex, path?: string): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `packages/theia-extensions/src/node/darkfactory/session-index-store.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionIndex, SESSION_INDEX_VERSION } from "./session-index.js";
import {
  loadSessionIndex,
  resolveSessionIndexPath,
  saveSessionIndex,
} from "./session-index-store.js";

const dirs: string[] = [];

async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "spexr-session-index-"));
  dirs.push(dir);
  return join(dir, "nested", "sessions-index.json");
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("resolveSessionIndexPath", () => {
  it("prefers the environment override so tests never touch the real home dir", () => {
    expect(resolveSessionIndexPath({ SPEXR_SESSION_INDEX: "/tmp/x.json" })).toBe("/tmp/x.json");
  });

  it("falls back to ~/.spexr/sessions-index.json, which is global, not per workspace", () => {
    expect(resolveSessionIndexPath({})).toMatch(/\.spexr[/\\]sessions-index\.json$/);
  });
});

describe("saveSessionIndex / loadSessionIndex", () => {
  it("creates missing directories and round-trips the index", async () => {
    const path = await tempPath();
    const index = new SessionIndex();
    index.upsert({
      sessionId: "a",
      harness: "claude",
      projectPath: "/p",
      projectName: "p",
      transcriptPath: "/t/a.jsonl",
      configDir: "/c",
      mtimeMs: 7,
      docHash: "h",
      vector: Float32Array.from([1, 0]),
      goal: "g",
      doc: "design system effects",
    });
    await saveSessionIndex(index, path);
    const restored = await loadSessionIndex(path);
    expect(restored.get("a")!.mtimeMs).toBe(7);
    expect([...restored.bm25.score("effects").keys()]).toEqual(["a"]);
  });

  it("returns an empty index for a missing file", async () => {
    expect((await loadSessionIndex(await tempPath())).size).toBe(0);
  });

  it("returns an empty index for unparseable content or a foreign version", async () => {
    const dir = await mkdtemp(join(tmpdir(), "spexr-session-index-"));
    dirs.push(dir);
    const broken = join(dir, "broken.json");
    await writeFile(broken, "{not json", "utf8");
    expect((await loadSessionIndex(broken)).size).toBe(0);

    const foreign = join(dir, "foreign.json");
    await writeFile(
      foreign,
      JSON.stringify({ version: SESSION_INDEX_VERSION + 1, records: [] }),
      "utf8",
    );
    expect((await loadSessionIndex(foreign)).size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/session-index-store.test.ts`
Expected: FAIL — cannot resolve `./session-index-store.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/theia-extensions/src/node/darkfactory/session-index-store.ts`:

```ts
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SessionIndex } from "./session-index.js";

/**
 * Where the session index lives. Global on purpose: sessions span every project
 * and both Claude config dirs, so the code index's per-workspace `.spexr/`
 * location does not apply. `SPEXR_SESSION_INDEX` overrides it for tests.
 */
export function resolveSessionIndexPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["SPEXR_SESSION_INDEX"] ?? join(homedir(), ".spexr", "sessions-index.json");
}

/** Load the persisted index; any failure yields an empty one the crawl refills. */
export async function loadSessionIndex(
  path: string = resolveSessionIndexPath(),
): Promise<SessionIndex> {
  try {
    return SessionIndex.fromJSON(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return new SessionIndex();
  }
}

/**
 * Persist the index through a temporary file in the same directory, so a crash
 * mid-write leaves the previous index intact rather than a truncated one.
 */
export async function saveSessionIndex(
  index: SessionIndex,
  path: string = resolveSessionIndexPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(index.toJSON()), "utf8");
  await rename(tmp, path);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/session-index-store.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/session-index-store.ts packages/theia-extensions/src/node/darkfactory/session-index-store.test.ts
git commit -m "feat(darkfactory): persist the session index globally under ~/.spexr"
```

---

### Task 4: Shared bounded-concurrency helper

**Files:**

- Create: `packages/theia-extensions/src/node/darkfactory/concurrency.ts`
- Modify: `packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts` (remove the local `forEachConcurrent` definition near line 764, import and re-export it instead)
- Test: `packages/theia-extensions/src/node/darkfactory/concurrency.test.ts`

**Interfaces:**

- Produces: `forEachConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void>`.

Why this task exists: the indexer needs the same bounded fan-out the wall scan uses, and importing it from the service would make the service and the indexer import each other.

- [ ] **Step 1: Write the failing test**

Create `packages/theia-extensions/src/node/darkfactory/concurrency.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { forEachConcurrent } from "./concurrency.js";

describe("forEachConcurrent", () => {
  it("visits every item and never exceeds the limit", async () => {
    const seen: number[] = [];
    let inFlight = 0;
    let peak = 0;
    await forEachConcurrent([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      seen.push(n);
      inFlight -= 1;
    });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("does nothing for an empty list", async () => {
    await expect(forEachConcurrent([], 4, async () => {})).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/concurrency.test.ts`
Expected: FAIL — cannot resolve `./concurrency.js`.

- [ ] **Step 3: Move the helper**

Create `packages/theia-extensions/src/node/darkfactory/concurrency.ts` with the body currently at `spexr-darkfactory-backend-service.ts:764`:

```ts
/** Run `fn` over `items` with at most `limit` in flight; resolves when all are done. */
export async function forEachConcurrent<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
```

In `spexr-darkfactory-backend-service.ts`: delete the local definition and add, next to the other imports, `import { forEachConcurrent } from "./concurrency.js";` plus `export { forEachConcurrent };` so existing importers keep working.

- [ ] **Step 4: Run the full package test suite**

Run: `pnpm --filter @spexr/theia-extensions test`
Expected: PASS, including the pre-existing backend service tests.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/concurrency.ts packages/theia-extensions/src/node/darkfactory/concurrency.test.ts packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts
git commit -m "refactor(darkfactory): extract forEachConcurrent so the indexer can share it"
```

---

### Task 5: Incremental crawl

**Files:**

- Create: `packages/theia-extensions/src/node/darkfactory/session-indexer.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/session-indexer.test.ts`

**Interfaces:**

- Consumes: `SessionIndex`, `SessionRecord` from `./session-index.js`; `buildSessionDoc`, `toolTargets` from `./session-doc.js`; `sessionGoal`, `recentAssistantProse`, `TurnEntry` from `./turns.js`; `forEachConcurrent` from `./concurrency.js`.
- Produces: `IndexableSession`, `SessionIndexerDeps`, `runSessionIndex(deps: SessionIndexerDeps): Promise<void>`, `EMBED_BATCH`, `PROSE_SEGMENTS`.

- [ ] **Step 1: Write the failing test**

Create `packages/theia-extensions/src/node/darkfactory/session-indexer.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SessionIndex } from "./session-index.js";
import { runSessionIndex, type IndexableSession } from "./session-indexer.js";

function session(id: string, mtimeMs: number, goal: string): IndexableSession {
  return {
    sessionId: id,
    harness: "claude",
    projectPath: `/p/${id}`,
    transcriptPath: `/t/${id}.jsonl`,
    configDir: "/c",
    mtimeMs,
    loadEntries: async () => [
      { message: { role: "user", content: goal } },
      { message: { role: "assistant", content: [{ type: "text", text: "done" }] } },
    ],
  };
}

/** Embeds to a unit vector whose single non-zero slot is derived from length. */
const embed = async (texts: string[]): Promise<Float32Array[]> =>
  texts.map((t) => Float32Array.from([t.length, 1]));

describe("runSessionIndex", () => {
  it("indexes every listed session and persists once at the end", async () => {
    const index = new SessionIndex();
    const save = vi.fn(async () => {});
    await runSessionIndex({
      index,
      embed,
      list: async () => [session("a", 1, "add effects"), session("b", 2, "fix git")],
      save,
    });
    expect(index.size).toBe(2);
    expect(index.get("a")!.goal).toBe("add effects");
    expect(index.get("a")!.projectName).toBe("a");
    expect(save).toHaveBeenCalled();
  });

  it("skips sessions whose mtime has not changed", async () => {
    const index = new SessionIndex();
    const load = vi.fn(session("a", 1, "add effects").loadEntries);
    const first = { ...session("a", 1, "add effects"), loadEntries: load };
    await runSessionIndex({ index, embed, list: async () => [first], save: async () => {} });
    await runSessionIndex({ index, embed, list: async () => [first], save: async () => {} });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("re-indexes a session whose mtime moved", async () => {
    const index = new SessionIndex();
    await runSessionIndex({
      index,
      embed,
      list: async () => [session("a", 1, "old goal")],
      save: async () => {},
    });
    await runSessionIndex({
      index,
      embed,
      list: async () => [session("a", 2, "new goal")],
      save: async () => {},
    });
    expect(index.get("a")!.goal).toBe("new goal");
    expect(index.size).toBe(1);
  });

  it("drops sessions that vanished from enumeration", async () => {
    const index = new SessionIndex();
    await runSessionIndex({
      index,
      embed,
      list: async () => [session("a", 1, "x"), session("b", 1, "y")],
      save: async () => {},
    });
    await runSessionIndex({
      index,
      embed,
      list: async () => [session("a", 1, "x")],
      save: async () => {},
    });
    expect(index.ids()).toEqual(["a"]);
  });

  it("keeps the stored vector when a touched transcript still reads the same", async () => {
    const index = new SessionIndex();
    const embedSpy = vi.fn(embed);
    await runSessionIndex({
      index,
      embed: embedSpy,
      list: async () => [session("a", 1, "same goal")],
      save: async () => {},
    });
    await runSessionIndex({
      index,
      embed: embedSpy,
      list: async () => [session("a", 2, "same goal")],
      save: async () => {},
    });
    expect(embedSpy).toHaveBeenCalledTimes(1);
    expect(index.get("a")!.mtimeMs).toBe(2);
  });

  it("reports progress, ending at done === total", async () => {
    const progress: Array<[number, number]> = [];
    await runSessionIndex({
      index: new SessionIndex(),
      embed,
      list: async () => [session("a", 1, "x"), session("b", 1, "y")],
      save: async () => {},
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(progress.at(-1)).toEqual([2, 2]);
  });

  it("skips a session whose entries cannot be read, without failing the crawl", async () => {
    const index = new SessionIndex();
    const broken: IndexableSession = {
      ...session("bad", 1, "x"),
      loadEntries: async () => {
        throw new Error("unreadable");
      },
    };
    await runSessionIndex({
      index,
      embed,
      list: async () => [broken, session("ok", 1, "y")],
      save: async () => {},
    });
    expect(index.ids()).toEqual(["ok"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/session-indexer.test.ts`
Expected: FAIL — cannot resolve `./session-indexer.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/theia-extensions/src/node/darkfactory/session-indexer.ts`:

```ts
import { basename } from "node:path";
import { createHash } from "node:crypto";
import { forEachConcurrent } from "./concurrency.js";
import { buildSessionDoc, toolTargets } from "./session-doc.js";
import { recentAssistantProse, sessionGoal, type TurnEntry } from "./turns.js";
import type { SessionIndex, SessionRecord } from "./session-index.js";
import type { HarnessId } from "../../common/harness/harness-types.js";

/** One session the crawl can index, flattened out of its harness ref. */
export interface IndexableSession {
  sessionId: string;
  harness: HarnessId;
  transcriptPath: string;
  configDir: string;
  mtimeMs: number;
  loadEntries(): Promise<unknown[]>;
  /** The project path is NOT on the ref: Claude refs carry `projectPath: ""`
   *  and the real working directory only appears once the transcript is
   *  parsed. Called only for sessions the crawl has decided to index. */
  parse(): Promise<ParsedTranscript>;
}

export interface SessionIndexerDeps {
  index: SessionIndex;
  embed(texts: string[]): Promise<Float32Array[]>;
  list(): Promise<IndexableSession[]>;
  save(index: SessionIndex): Promise<void>;
  onProgress?(done: number, total: number): void;
  now?(): number;
}

/** Documents per embedding call — the encoder batches well, memory stays flat. */
export const EMBED_BATCH = 16;
/** Transcripts parsed at once, matching the wall scan's own fan-out. */
const PARSE_CONCURRENCY = 8;
/** Assistant prose segments kept per session document. */
export const PROSE_SEGMENTS = 6;
/** Never persist more often than this while a crawl runs. */
const SAVE_INTERVAL_MS = 5_000;

/** Stable content key: an mtime touch that left the text alone skips the encoder. */
function hashDoc(doc: string): string {
  return createHash("sha1").update(doc).digest("hex");
}

/**
 * Read one session and turn it into an index record. Returns undefined when the
 * transcript cannot be read or carries nothing worth indexing, so one broken
 * session never fails the crawl.
 */
async function toRecord(
  session: IndexableSession,
  vector: Float32Array,
  doc: string,
  goal: string,
): Promise<SessionRecord> {
  return {
    sessionId: session.sessionId,
    harness: session.harness,
    projectPath: session.projectPath,
    projectName: basename(session.projectPath),
    transcriptPath: session.transcriptPath,
    configDir: session.configDir,
    mtimeMs: session.mtimeMs,
    docHash: hashDoc(doc),
    vector,
    goal,
    doc,
  };
}

/**
 * Bring the index in line with what the harnesses currently enumerate: index
 * what is new or changed, drop what is gone, and leave everything else alone.
 * Work is batched and awaited between batches so the backend event loop stays
 * free — the wall's own scan already caps itself for the same reason.
 */
export async function runSessionIndex(deps: SessionIndexerDeps): Promise<void> {
  const { index, embed, list, save, onProgress } = deps;
  const now = deps.now ?? Date.now;
  const sessions = await list();

  const live = new Set(sessions.map((s) => s.sessionId));
  for (const id of index.ids()) {
    if (!live.has(id)) index.remove(id);
  }

  const stale = sessions.filter((s) => !index.isCurrent(s.sessionId, s.mtimeMs));
  const total = sessions.length;
  let done = total - stale.length;
  onProgress?.(done, total);

  let lastSave = now();
  for (let i = 0; i < stale.length; i += EMBED_BATCH) {
    const batch = stale.slice(i, i + EMBED_BATCH);
    const prepared: Array<{ session: IndexableSession; doc: string; goal: string }> = [];

    await forEachConcurrent(batch, PARSE_CONCURRENCY, async (session) => {
      let entries: TurnEntry[];
      try {
        entries = (await session.loadEntries()) as TurnEntry[];
      } catch {
        return; // unreadable transcript → not indexable, and not fatal
      }
      const goal = sessionGoal(entries);
      const doc = buildSessionDoc({
        projectPath: session.projectPath,
        goal,
        prose: recentAssistantProse(entries, PROSE_SEGMENTS),
        targets: toolTargets(entries),
      });
      if (!doc) return;
      prepared.push({ session, doc, goal });
    });

    // A transcript can be touched without its indexed head/tail changing — a
    // resumed session that only appended past the bounded read, say. Those keep
    // their vector and only take the new mtime, which is what the stored content
    // hash is for.
    const fresh: typeof prepared = [];
    for (const p of prepared) {
      const existing = index.get(p.session.sessionId);
      if (existing && existing.docHash === hashDoc(p.doc)) {
        index.upsert({ ...existing, mtimeMs: p.session.mtimeMs });
      } else {
        fresh.push(p);
      }
    }
    if (fresh.length > 0) {
      const vectors = await embed(fresh.map((p) => p.doc));
      for (const [j, p] of fresh.entries()) {
        index.upsert(await toRecord(p.session, vectors[j]!, p.doc, p.goal));
      }
    }

    done += batch.length;
    onProgress?.(Math.min(done, total), total);
    if (now() - lastSave >= SAVE_INTERVAL_MS) {
      await save(index);
      lastSave = now();
    }
  }

  await save(index);
  onProgress?.(total, total);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/session-indexer.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/session-indexer.ts packages/theia-extensions/src/node/darkfactory/session-indexer.test.ts
git commit -m "feat(darkfactory): crawl sessions into the index incrementally"
```

---

### Task 6: Protocol surface

**Files:**

- Modify: `packages/theia-extensions/src/common/darkfactory-protocol.ts`
- Modify: `packages/theia-extensions/src/browser/darkfactory/darkfactory-client.ts`

**Interfaces:**

- Produces: `SessionHit`, `SpexrDarkfactoryService.searchSessions`, `SpexrDarkfactoryClient.onSessionIndexProgress`, and on the frontend dispatcher `onSessionIndexProgress$: Event<{ done: number; total: number }>`.

No test of its own: these are type declarations plus one emitter, exercised by Tasks 7 and 8.

- [ ] **Step 1: Extend the protocol**

In `packages/theia-extensions/src/common/darkfactory-protocol.ts`, after the `AgentSummary` interface add:

```ts
/** One session matching a natural-language query, ready to render as a tile. */
export interface SessionHit {
  tile: AgentTile;
  /** Hybrid score, dense and lexical blended; higher is a better match. */
  score: number;
  /** True when the session was outside the wall's current scan window. */
  archived: boolean;
}
```

In `SpexrDarkfactoryService` add:

```ts
  /** Rank indexed sessions against a natural-language query; `[]` for an empty query. */
  searchSessions(query: string): Promise<SessionHit[]>;
```

In `SpexrDarkfactoryClient` add:

```ts
  /** Session-index crawl progress; `done === total` means the crawl finished. */
  onSessionIndexProgress(done: number, total: number): void;
```

- [ ] **Step 2: Extend the frontend dispatcher**

In `packages/theia-extensions/src/browser/darkfactory/darkfactory-client.ts`, inside `SpexrDarkfactoryClientDispatcher`:

```ts
  private readonly indexProgress = new Emitter<{ done: number; total: number }>();
  readonly onSessionIndexProgress$: Event<{ done: number; total: number }> = this.indexProgress.event;

  onSessionIndexProgress(done: number, total: number): void {
    this.indexProgress.fire({ done, total });
  }
```

- [ ] **Step 3: Keep the backend compiling**

The service must satisfy the widened interface before the next task fills it in, so every commit stays green. In `spexr-darkfactory-backend-service.ts` add, next to `listConfigDirs`:

```ts
  /** Replaced in full by the search implementation; see the session index. */
  async searchSessions(): Promise<SessionHit[]> {
    return [];
  }
```

importing `type SessionHit` from the protocol.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @spexr/theia-extensions run typecheck && pnpm --filter @spexr/theia-extensions run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/common/darkfactory-protocol.ts packages/theia-extensions/src/browser/darkfactory/darkfactory-client.ts packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts
git commit -m "feat(darkfactory): declare the session search protocol surface"
```

---

### Task 7: Query, hit tiles, and openability

**Files:**

- Create: `packages/theia-extensions/src/node/darkfactory/tile-builder.ts`
- Create: `packages/theia-extensions/src/node/darkfactory/session-query.ts`
- Modify: `packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts`
- Modify: `packages/theia-extensions/src/node/spexr-backend-module.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/session-query.test.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.test.ts` (add cases)

**Interfaces:**

- Consumes: `SessionIndex` from `./session-index.js`; `expandQuery` from `../search/query-expander.js`; `AgentTile`, `SessionHit` from `../../common/darkfactory-protocol.js`; `EmbedderToken` from `../search/embedding-model.js`.
- Produces: `buildTile(input: TileInput): AgentTile` in `tile-builder.ts`; `rankSessions(index, queryVector, expandedQuery): RankedSession[]` and `RankedSession` in `session-query.ts`; `searchSessions` on the backend service.

- [ ] **Step 1: Write the failing ranking test**

Create `packages/theia-extensions/src/node/darkfactory/session-query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SessionIndex, type SessionRecord } from "./session-index.js";
import { rankSessions } from "./session-query.js";

function record(id: string, vector: number[], doc: string): SessionRecord {
  return {
    sessionId: id,
    harness: "claude",
    projectPath: `/p/${id}`,
    projectName: id,
    transcriptPath: "",
    configDir: "",
    mtimeMs: 1,
    docHash: id,
    vector: Float32Array.from(vector),
    goal: doc,
    doc,
  };
}

describe("rankSessions", () => {
  it("ranks a session strong on both halves above one strong on neither", () => {
    const index = new SessionIndex();
    index.upsert(record("effects", [1, 0], "adding new effects to the spexr design system"));
    index.upsert(record("git", [0, 1], "hardening the git panel"));
    const ranked = rankSessions(index, Float32Array.from([1, 0]), "effects design system");
    expect(ranked[0]!.sessionId).toBe("effects");
    expect(ranked[0]!.score).toBeGreaterThan(0.18);
  });

  it("surfaces a lexical-only match the dense pass misses", () => {
    const index = new SessionIndex();
    index.upsert(record("effects", [0, 1], "introducing nuovi effetti nel design system"));
    const ranked = rankSessions(index, Float32Array.from([1, 0]), "effetti");
    expect(ranked.map((r) => r.sessionId)).toContain("effects");
  });

  it("drops everything below the minimum score", () => {
    const index = new SessionIndex();
    index.upsert(record("unrelated", [0, 1], "unrelated words entirely"));
    expect(rankSessions(index, Float32Array.from([1, 0]), "design system")).toEqual([]);
  });

  it("returns at most 24 hits, best first", () => {
    const index = new SessionIndex();
    for (let i = 0; i < 40; i++) index.upsert(record(`s${i}`, [1, 0], "design system effects"));
    index.upsert(record("unrelated", [0, 1], "hardening the git panel"));
    const ranked = rankSessions(index, Float32Array.from([1, 0]), "design system effects");
    expect(ranked).toHaveLength(24);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[23]!.score);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/session-query.test.ts`
Expected: FAIL — cannot resolve `./session-query.js`.

- [ ] **Step 3: Write the ranking module**

Create `packages/theia-extensions/src/node/darkfactory/session-query.ts`:

```ts
import type { SessionIndex } from "./session-index.js";

/** Hits returned per query. */
export const TOP_K = 24;
/** Blend weights: the same split the code search uses. */
const DENSE_WEIGHT = 0.65;
const BM25_WEIGHT = 0.35;
/** Dense floor for candidate gathering — deliberately low, to widen the pool. */
const DENSE_CANDIDATE_THRESHOLD = 0.05;
/** A lexical score this close to the best one earns a place among the candidates. */
const BM25_CANDIDATE_RATIO = 0.3;
/** Final cut: below this a hit is noise rather than a match. */
const MIN_SCORE = 0.18;

export interface RankedSession {
  sessionId: string;
  score: number;
}

/**
 * Blend the dense and lexical passes into one ranking. The dense pass finds
 * paraphrase, the lexical pass finds the literal terms — file names, project
 * names, and the non-English words the English-only encoder cannot place.
 */
export function rankSessions(
  index: SessionIndex,
  queryVector: Float32Array,
  expandedQuery: string,
): RankedSession[] {
  const dense = index.searchDense(queryVector, TOP_K * 3, DENSE_CANDIDATE_THRESHOLD);
  const denseScores = new Map(dense.map((h) => [h.sessionId, h.score]));

  const lexical = index.bm25.score(expandedQuery);
  const maxLexical = Math.max(...lexical.values(), 0.001);

  const candidates = new Set(denseScores.keys());
  for (const [sessionId, score] of lexical) {
    if (score / maxLexical >= BM25_CANDIDATE_RATIO) candidates.add(sessionId);
  }

  const ranked: RankedSession[] = [];
  for (const sessionId of candidates) {
    const cosine = denseScores.get(sessionId) ?? 0;
    const bm25 = (lexical.get(sessionId) ?? 0) / maxLexical;
    const score = DENSE_WEIGHT * cosine + BM25_WEIGHT * bm25;
    if (score >= MIN_SCORE) ranked.push({ sessionId, score });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, TOP_K);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/session-query.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Extract tile construction**

Create `packages/theia-extensions/src/node/darkfactory/tile-builder.ts` and move the object literal currently built inside `listTiles` (`spexr-darkfactory-backend-service.ts`, the `tiles.push({...})` call) into it verbatim:

```ts
import { basename } from "node:path";
import { distillAction, lastActionFailed, recentActions } from "./action-distiller.js";
import type { TurnEntry } from "./turns.js";
import type { ParsedTranscript } from "../../common/harness/harness-types.js";
import type { HarnessId } from "../../common/harness/harness-types.js";
import type { AgentState, AgentTile } from "../../common/darkfactory-protocol.js";

/** Palette slots the frontend cycles through, keyed off the project path. */
const PALETTE_SIZE = 8;

export interface TileInput {
  sessionId: string;
  harness: HarnessId;
  transcriptPath: string;
  projectPath: string;
  mtimeMs: number;
  entries: TurnEntry[];
  parsed: ParsedTranscript;
  state: AgentState;
  needsYou: boolean;
  needsYouCertain: boolean;
  hashToIndex(value: string, buckets: number): number;
}

/**
 * Build one wall card from a parsed session. Shared by the wall scan and by
 * search, so a session found by query renders exactly like one on the wall.
 */
export function buildTile(input: TileInput): AgentTile {
  const { entries, parsed: p } = input;
  const action = distillAction(entries);
  return {
    sessionId: input.sessionId,
    harness: input.harness,
    transcriptPath: input.transcriptPath,
    projectPath: input.projectPath,
    projectName: basename(input.projectPath),
    state: input.state,
    needsYou: input.needsYou,
    needsYouCertain: input.needsYouCertain,
    lastFailed: lastActionFailed(entries),
    goal: p.goal || p.lastPrompt,
    actionLine: action.line,
    recentActions: recentActions(entries, 4),
    lastActivityMs: input.mtimeMs,
    turnCount: p.userTurns,
    accentId: input.hashToIndex(input.projectPath, PALETTE_SIZE),
    ...(action.tool !== undefined ? { tool: action.tool } : {}),
    ...(action.target !== undefined ? { target: action.target } : {}),
    ...(p.gitBranch !== undefined ? { gitBranch: p.gitBranch } : {}),
    ...(p.mode !== undefined ? { mode: p.mode } : {}),
    ...(p.permissionMode !== undefined ? { permissionMode: p.permissionMode } : {}),
  };
}
```

Delete the now-unused `const PALETTE_SIZE = 8;` from the service (line 65) — it moves into `tile-builder.ts`, and leaving it behind fails lint.

Then in `listTiles`, replace the inline `tiles.push({ ... })` with:

```ts
tiles.push(
  buildTile({
    sessionId: ref.sessionId,
    harness: u.harness.id,
    transcriptPath: u.claude?.transcriptPath ?? "",
    projectPath: cwd,
    mtimeMs: ref.mtimeMs,
    entries,
    parsed: p,
    state,
    needsYou,
    needsYouCertain,
    hashToIndex,
  }),
);
```

- [ ] **Step 6: Run the existing service tests to prove the extraction changed nothing**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/spexr-darkfactory-backend-service.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 7: Write the failing service test for archived hits**

Append to `packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.test.ts`, following the existing fixture style in that file:

```ts
describe("searchSessions", () => {
  it("returns [] for an empty query without touching the index", async () => {
    const service = makeService({});
    expect(await service.searchSessions("   ")).toEqual([]);
  });

  it("opens an archived hit even after a scan has cleared the live index", async () => {
    // 61 sessions, the archived one carrying the OLDEST mtime: listTiles sorts
    // descending and keeps the first RECENT_LIMIT (60), so anything newer than
    // the tail would land inside the window and come back with archived false.
    const service = makeService({
      sessionCount: 61,
      archivedGoal: "adding new effects to the design system",
    });
    await service.indexNow();
    await service.listTiles(); // clears the scan-owned index, as every poll does

    const hits = await service.searchSessions("new effects design system");
    expect(hits.length).toBeGreaterThan(0);
    const archived = hits.find((h) => h.archived);
    expect(archived).toBeDefined();
    expect(archived!.tile.goal).toContain("effects");

    const plan = await service.planFocus(archived!.tile.sessionId);
    expect(plan.projectPath).not.toBe("");
    expect(plan.kind === "resume-terminal" || plan.kind === "readonly-follow").toBe(true);
  });
});
```

Extend the file's existing `makeService` helper with the `sessionCount` and `archivedGoal` options, and inject a deterministic embedder (`embed: async (texts) => texts.map(() => Float32Array.from([1, 0]))`) through the new dep introduced in Step 8.

- [ ] **Step 8: Wire search into the backend service**

In `spexr-darkfactory-backend-service.ts`:

1. Add imports: `loadSessionIndex`, `saveSessionIndex` from `./session-index-store.js`; `runSessionIndex`, `type IndexableSession` from `./session-indexer.js`; `rankSessions` from `./session-query.js`; `expandQuery` from `../search/query-expander.js`; `SessionIndex` from `./session-index.js`; `type SessionHit` from the protocol.
2. Add to `DarkfactoryDeps`:

```ts
  /** Sentence encoder for the session index; absent in tests that do not search. */
  embed?: (texts: string[]) => Promise<Float32Array[]>;
  /** Index location override, so tests never touch the real home directory. */
  sessionIndexPath?: string;
```

and assign them in the constructor beside the existing `const d = deps ?? {};` block:

```ts
this.embed = d.embed;
this.sessionIndexPath = d.sessionIndexPath;
```

with the matching fields `private readonly embed: ((texts: string[]) => Promise<Float32Array[]>) | undefined;` and `private readonly sessionIndexPath: string | undefined;`. 3. Add fields:

```ts
  private sessionIndex?: Promise<SessionIndex>;
  /** Metadata for sessions reached through search, not through the scan.
   *  `listTiles` clears `index` on every poll, so a hit registered there would
   *  stop opening within one interval; this map is owned by the search path and
   *  only grows, so a hit the user pinned stays openable after later queries. */
  private readonly searchMeta = new Map<string, SessionMeta>();
  /** The tiles the last scan produced, so a hit inside the window is returned
   *  as-is rather than re-parsed and re-classified with different inputs. */
  private readonly lastTiles = new Map<string, AgentTile>();
  /** Enumeration is a full transcript scan plus an `opencode db` spawn; a query
   *  must not pay for it on every keystroke's debounce. */
  private enumCache?: { at: number; value: UnifiedRef[] };
  private indexing = false;
```

and beside the other constants:

```ts
/** Enumeration freshness floor for the search path, mirroring LIVE_DIRS_TTL_MS. */
const ENUM_TTL_MS = 15_000;
/** The session index crawl waits this long after startup, so it never competes
 *  with the first wall scan for the event loop. */
const FIRST_CRAWL_DELAY_MS = 10_000;
```

Populate `lastTiles` in `listTiles`: clear it beside `this.index.clear()`, and set each tile as it is pushed.

4. Resolve metadata through both maps:

```ts
  private meta(sessionId: string): SessionMeta | undefined {
    return this.index.get(sessionId) ?? this.searchMeta.get(sessionId);
  }
```

Replace the three `this.index.get(sessionId)` reads in `summarize`, `planFocus` and `startFollow` with `this.meta(sessionId)`. Leave `listTiles`'s writes to `this.index` untouched.

5. Add the crawl entry point, scheduled 10 s after construction and callable directly from tests:

```ts
  /** Bring the session index up to date; at most one crawl runs at a time. */
  async indexNow(): Promise<void> {
    if (this.indexing || !this.embed) return;
    this.indexing = true;
    try {
      const index = await this.loadIndex();
      await runSessionIndex({
        index,
        embed: this.embed,
        list: () => this.indexableSessions(),
        save: (i) => saveSessionIndex(i, this.sessionIndexPath),
        onProgress: (done, total) => this.client?.onSessionIndexProgress(done, total),
      });
    } finally {
      this.indexing = false;
    }
  }

  private async indexableSessions(): Promise<IndexableSession[]> {
    const refs = await this.cachedTranscripts();
    return refs.map((u) => ({
      sessionId: u.ref.sessionId,
      harness: u.harness.id,
      projectPath: u.ref.projectPath,
      transcriptPath: u.claude?.transcriptPath ?? "",
      configDir: u.claude?.configDir ?? "",
      mtimeMs: u.ref.mtimeMs,
      loadEntries: u.ref.loadEntries,
      parse: () => u.harness.parseTranscript(u.ref),
    }));
  }
```

The crawl reads `parsed.cwd` for the project path and applies the wall's two
admission rules — no working directory, or `interactive: false` (an SDK or
subagent run nobody can open) — before building a document.

6. Implement the query:

```ts
  async searchSessions(query: string): Promise<SessionHit[]> {
    if (!query.trim() || !this.embed) return [];
    const index = await this.loadIndex();
    if (index.size === 0) return [];

    const expanded = expandQuery(query);
    const [vector] = await this.embed([expanded]);
    if (!vector) return [];
    const ranked = rankSessions(index, vector, expanded);
    if (ranked.length === 0) return [];

    // A hit the last scan already rendered is returned as that scan built it —
    // re-classifying it here would feed classifySession different inputs and
    // could demote a live session. Only sessions outside the window are parsed,
    // and only the hits among them, never the whole index.
    const scored = new Map(ranked.map((r) => [r.sessionId, r.score]));
    const hits: SessionHit[] = [];
    const archived: string[] = [];
    for (const { sessionId } of ranked) {
      const tile = this.lastTiles.get(sessionId);
      if (tile) hits.push({ tile, score: scored.get(sessionId)!, archived: false });
      else archived.push(sessionId);
    }

    if (archived.length > 0) {
      const refs = new Map((await this.cachedTranscripts()).map((u) => [u.ref.sessionId, u]));
      const live = await this.cachedLiveDirs();
      const now = this.now();
      const built: SessionHit[] = [];
      await forEachConcurrent(archived, PARSE_CONCURRENCY, async (sessionId) => {
        const u = refs.get(sessionId);
        if (!u) return; // indexed but gone from disk; the next crawl drops it
        const p = await u.harness.parseTranscript(u.ref);
        if (!p.cwd || !p.interactive) return;
        const entries = (await u.ref.loadEntries()) as TurnEntry[];
        const { state, needsYou, needsYouCertain } = classifySession(
          p.cwd,
          u.ref.mtimeMs,
          false, // outside the scan window, so never its project's newest
          live,
          now,
          entries,
          p.permissionMode,
        );
        this.searchMeta.set(sessionId, {
          transcriptPath: u.claude?.transcriptPath ?? "",
          projectPath: p.cwd,
          configDir: u.claude?.configDir ?? "",
          state,
          mtimeMs: u.ref.mtimeMs,
          harnessId: u.harness.id,
          loadEntries: u.ref.loadEntries,
        });
        built.push({
          tile: buildTile({
            sessionId,
            harness: u.harness.id,
            transcriptPath: u.claude?.transcriptPath ?? "",
            projectPath: p.cwd,
            mtimeMs: u.ref.mtimeMs,
            entries,
            parsed: p,
            state,
            needsYou,
            needsYouCertain,
            hashToIndex,
          }),
          score: scored.get(sessionId)!,
          archived: true,
        });
      });
      hits.push(...built);
    }

    hits.sort((a, b) => b.score - a.score);
    return hits;
  }

  /** Enumeration, cached briefly: one query must not rescan every transcript. */
  private async cachedTranscripts(): Promise<UnifiedRef[]> {
    const now = this.now();
    if (this.enumCache && now - this.enumCache.at < ENUM_TTL_MS) return this.enumCache.value;
    const value = await this.listTranscripts();
    this.enumCache = { at: now, value };
    return value;
  }

  private loadIndex(): Promise<SessionIndex> {
    if (!this.sessionIndex) this.sessionIndex = loadSessionIndex(this.sessionIndexPath);
    return this.sessionIndex;
  }
```

7. In the constructor, schedule the first crawl and keep the timer unref'd so it never holds the process open:

```ts
if (this.embed) {
  setTimeout(() => void this.indexNow().catch(() => {}), FIRST_CRAWL_DELAY_MS).unref?.();
}
```

Both constants were added in step 3.

8. In `packages/theia-extensions/src/node/spexr-backend-module.ts`, pass the embedder into the service:

```ts
        new SpexrDarkfactoryBackendService({
          generator: ctx.container.get<DescriptionGenerator>(DescriptionGeneratorToken),
          embed: (texts) => ctx.container.get<Embedder>(EmbedderToken).embed(texts),
        }),
```

adding `import { EmbedderToken, type Embedder } from "./search/embedding-model.js";` to that file's imports.

- [ ] **Step 9: Run the service tests**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/node/darkfactory/spexr-darkfactory-backend-service.test.ts`
Expected: PASS, including the two new cases.

- [ ] **Step 10: Validate the package**

Run: `pnpm --filter @spexr/theia-extensions run typecheck && pnpm --filter @spexr/theia-extensions run lint && pnpm --filter @spexr/theia-extensions test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory packages/theia-extensions/src/node/spexr-backend-module.ts
git commit -m "feat(darkfactory): answer natural-language session queries"
```

---

### Task 8: Query bar on the wall

**Files:**

- Create: `packages/theia-extensions/src/browser/darkfactory/session-search.ts`
- Test: `packages/theia-extensions/src/browser/darkfactory/session-search.test.ts`
- Modify: `packages/theia-extensions/src/browser/darkfactory/darkfactory-wall-widget.tsx`
- Modify: `packages/theia-extensions/src/browser/style/spexr.css`

**Interfaces:**

- Consumes: `SessionHit` from `../../common/darkfactory-protocol.js`; `SpexrDarkfactoryServiceProxy`, `SpexrDarkfactoryClientDispatcher`.
- Produces: `SessionSearchState` class with `query`, `hits`, `pending`, `setQuery(text, run)`, `clear()`, `accept(token, hits)`, and `SEARCH_DEBOUNCE_MS`.

- [ ] **Step 1: Write the failing test**

Create `packages/theia-extensions/src/browser/darkfactory/session-search.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { SessionSearchState } from "./session-search.js";

describe("SessionSearchState", () => {
  it("issues one query per debounce window, with the latest text", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => []);
    const state = new SessionSearchState();
    state.setQuery("des", run);
    state.setQuery("design sys", run);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("design sys");
    vi.useRealTimers();
  });

  it("repaints through the callback when results are accepted", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const state = new SessionSearchState(onChange);
    state.setQuery("design", async () => []);
    await vi.advanceTimersByTimeAsync(300);
    expect(onChange).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("discards a result whose query was superseded", () => {
    const state = new SessionSearchState();
    const stale = state.token();
    state.setQuery("newer", async () => []);
    state.accept(stale, [{ tile: { sessionId: "a" }, score: 1, archived: false } as never]);
    expect(state.hits).toEqual([]);
  });

  it("clears without issuing a query", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => []);
    const state = new SessionSearchState();
    state.setQuery("design", run);
    state.clear();
    await vi.advanceTimersByTimeAsync(300);
    expect(run).not.toHaveBeenCalled();
    expect(state.query).toBe("");
    expect(state.hits).toEqual([]);
    vi.useRealTimers();
  });

  it("treats a whitespace-only query as empty", async () => {
    vi.useFakeTimers();
    const run = vi.fn(async () => []);
    const state = new SessionSearchState();
    state.setQuery("   ", run);
    await vi.advanceTimersByTimeAsync(300);
    expect(run).not.toHaveBeenCalled();
    expect(state.active).toBe(false);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/browser/darkfactory/session-search.test.ts`
Expected: FAIL — cannot resolve `./session-search.js`.

- [ ] **Step 3: Write the implementation**

Create `packages/theia-extensions/src/browser/darkfactory/session-search.ts`:

```ts
import type { SessionHit } from "../../common/darkfactory-protocol.js";

/** Typing settles for this long before a query is issued. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Query state for the wall's search bar, kept out of the widget so the timing
 * rules — debounce, supersede, clear — are testable without a DOM.
 */
export class SessionSearchState {
  query = "";
  hits: SessionHit[] = [];
  pending = false;

  private seq = 0;
  private timer?: ReturnType<typeof setTimeout>;

  /** `onChange` fires when accepted results change what should be on screen. */
  constructor(private readonly onChange: () => void = () => {}) {}

  /** True while a query is in force, so the wall should render hits, not tiles. */
  get active(): boolean {
    return this.query.trim().length > 0;
  }

  /** The token a result must still match to be accepted. */
  token(): number {
    return this.seq;
  }

  setQuery(text: string, run: (query: string) => Promise<SessionHit[]>): void {
    this.query = text;
    this.seq += 1;
    if (this.timer) clearTimeout(this.timer);
    if (!this.active) {
      this.hits = [];
      this.pending = false;
      return;
    }
    const token = this.seq;
    this.pending = true;
    this.timer = setTimeout(() => {
      void run(this.query.trim()).then((hits) => this.accept(token, hits));
    }, SEARCH_DEBOUNCE_MS);
  }

  /** Take results only when they answer the query still on screen. */
  accept(token: number, hits: SessionHit[]): void {
    if (token !== this.seq) return;
    this.hits = hits;
    this.pending = false;
    this.onChange();
  }

  clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.seq += 1;
    this.query = "";
    this.hits = [];
    this.pending = false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions exec vitest run src/browser/darkfactory/session-search.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Render the bar and the results**

In `darkfactory-wall-widget.tsx`:

1. Import `SessionSearchState` and `type SessionHit`, and add fields:

```ts
  private readonly search = new SessionSearchState(() => this.update());
  private indexProgress?: { done: number; total: number };
```

The callback is how a result repaints: a query can take seconds, and nothing else wakes the widget when it lands.

2. In `init()`, subscribe to progress alongside the existing client subscriptions:

```ts
this.client.onSessionIndexProgress$(({ done, total }) => {
  this.indexProgress = done >= total ? undefined : { done, total };
  this.update();
});
```

3. Add the handlers:

```ts
  private readonly onSearchInput = (text: string): void => {
    this.search.setQuery(text, (q) => this.service.searchSessions(q));
    this.update();
  };

  private readonly onSearchKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    this.search.clear();
    this.update();
  };
```

4. Render the bar directly under `<NewSessionLauncher …/>`:

```tsx
<div className="spexr-df-search">
  <i className="codicon codicon-search" />
  <input
    className="spexr-df-search__input"
    placeholder="Find a session — describe it"
    value={this.search.query}
    onChange={(e) => this.onSearchInput(e.target.value)}
    onKeyDown={this.onSearchKeyDown}
  />
  {this.search.pending && <i className="codicon codicon-loading codicon-modifier-spin" />}
  {this.search.active && !this.search.pending && (
    <span className="spexr-df-search__count">{visibleHits.length} found</span>
  )}
  {this.indexProgress && (
    <span className="spexr-df-search__progress">
      indexing {this.indexProgress.done}/{this.indexProgress.total}
    </span>
  )}
  {this.search.active && (
    <button
      className="spexr-df-search__clear"
      onClick={() => {
        this.search.clear();
        this.update();
      }}
    >
      Clear
    </button>
  )}
</div>
```

5. Compute the visible hits above the `return`, after `expanded`/`rest` are built, so pinned and launched cards are untouched:

```tsx
// Trashed sessions and sessions already lifted into a pinned card are not
// repeated in the result list; the pinned card IS that session on screen.
const trashed = new Set(this.trashedIds());
const visibleHits = this.search.hits.filter(
  (h) => !trashed.has(h.tile.sessionId) && !this.pinned.includes(h.tile.sessionId),
);
```

6. Replace only the grid branch. The `expanded`/`launched` block inside `spexr-df-active` stays exactly as it is; the tail becomes:

```tsx
        {this.search.active ? (
          visibleHits.length === 0 ? (
            <div className="spexr-df-empty">
              {this.search.pending
                ? "Searching…"
                : this.indexProgress
                  ? `No session matches "${this.search.query}" yet — still indexing.`
                  : `No session matches "${this.search.query}".`}
            </div>
          ) : (
            <div className="spexr-df-grid">
              {visibleHits.map((h) => this.renderCard(h.tile, now, false, h.archived))}
            </div>
          )
        ) : tiles.length === 0 ? (
          /* … the existing empty / groups / flat branches, unchanged … */
        )}
```

7. Give `renderCard` an optional fourth parameter `archived = false` and pass it through to `AgentTileCard` as a new optional `archived?: boolean` prop; in `agent-tile.tsx` render it as a small chip (`<span className="spexr-df-chip spexr-df-chip--archived">archived</span>`) beside the existing harness chip when true.

- [ ] **Step 6: Style the bar**

In `packages/theia-extensions/src/browser/style/spexr.css`, next to the existing `.spexr-df-active` rules:

```css
.spexr-df-search {
  display: flex;
  align-items: center;
  gap: var(--sl-space-2);
  padding: var(--sl-space-2) var(--sl-space-3);
}
.spexr-df-search__input {
  flex: 1;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--theia-editorWidget-border);
  color: var(--theia-foreground);
  padding: var(--sl-space-1) 0;
  font-size: 1.05em;
}
.spexr-df-search__input:focus {
  outline: none;
  border-bottom-color: var(--theia-focusBorder);
}
.spexr-df-search__count,
.spexr-df-search__progress {
  opacity: 0.65;
  font-size: 0.85em;
  white-space: nowrap;
}
.spexr-df-chip--archived {
  opacity: 0.7;
  font-style: italic;
}
```

- [ ] **Step 7: Validate**

Run: `pnpm --filter @spexr/theia-extensions run typecheck && pnpm --filter @spexr/theia-extensions run lint && pnpm --filter @spexr/theia-extensions test`
Expected: PASS.

- [ ] **Step 8: Verify by hand that no live session is disturbed**

Run: `pnpm dev`. Open Darkfactory, pin a running session so its terminal is attached, then type a query in the bar. Confirm the pinned card keeps rendering with its terminal alive and its scrollback intact while the grid below is replaced by results, and that clearing the query restores the wall.

- [ ] **Step 9: Commit**

```bash
git add packages/theia-extensions/src/browser/darkfactory packages/theia-extensions/src/browser/style/spexr.css
git commit -m "feat(darkfactory): find sessions from a query bar on the wall"
```

---

## Self-Review

**Spec coverage:** AC-1 → Task 1. AC-2 → Task 2. AC-3 → Task 3. AC-4, AC-5, AC-6 → Tasks 4 and 5. AC-7, AC-12 → Task 6 (declaration) and Task 7 (implementation). AC-8 → Task 7 Steps 1-4. AC-9 → Task 7 Steps 5-8. AC-10, AC-11 → Task 7 Step 8, tested in Step 7. AC-13, AC-17 → Task 8 Steps 5-6. AC-14 → Task 8 Steps 1-4. AC-15 → Task 8 Steps 5-6 and the manual check in Step 8. AC-16, AC-18 → Task 8 Step 5.

**Type consistency:** `SessionRecord` is defined in Task 2 and used unchanged in Tasks 3, 5 and 7. `IndexableSession` is defined in Task 5 and produced by `indexableSessions()` in Task 7. `SessionHit` is declared in Task 6 and consumed in Tasks 7 and 8. `buildTile`/`TileInput` are defined in Task 7 and used by both `listTiles` and `searchSessions`. `forEachConcurrent` keeps its original signature across the move in Task 4.
