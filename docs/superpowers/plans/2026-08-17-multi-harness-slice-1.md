# Multi-harness Slice 1 — HarnessAdapter extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `HarnessAdapter` seam with a live `ClaudeHarness` implementation and a `HarnessRegistry`, wired into real call sites so the abstraction ships **used, not dead** — with zero observable behavior change — so later slices can add `OpencodeHarness`.

**Architecture:** A process-agnostic `HarnessAdapter` interface lives in `common/harness/`. The pure resume helpers move there too (so both the node backend and the browser frontend import one copy). `ClaudeHarness` implements the interface by delegating to the existing Claude logic. `HarnessRegistry` is a pure detect/select module. Slice 1 wires `claudeHarness` into two live call sites (the Darkfactory process scanner default and the resume-terminal manager) so there is no unreferenced code.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), Vitest, Inversify (Theia DI). No new dependencies.

## Contract

The Slice 1 acceptance criteria live in `docs/specs/0012-harness-adapter-slice-1.md` (authoritative). This plan implements that contract.

## Global Constraints

- **No behavior change.** Every wiring edit must compute exactly what today's code computes. Existing tests (`process-scanner.test.ts`, `resume-args.test.ts`, `config-dirs.test.ts`, `claude-profile-detector` tests, `spexr-darkfactory-backend-service.test.ts`) must pass **unchanged**.
- **No dead code.** By the end of the slice, `claudeHarness` and the registry helpers are referenced from live `src/` (not just tests). Verified in Task 7.
- **Import specifiers use `.js`** (NodeNext). **Vitest** imports: `import { describe, expect, test } from "vitest"`.
- **No `any`, no unsafe casts** (`x as HarnessAdapter` on incomplete objects is banned — use full stub literals). ~4-line doc comment on each new exported symbol.
- **Harness ids** are the string literals `"claude"` / `"opencode"` (union `HarnessId`).
- **Dependency direction:** `common/` must not import from `node/`. That is why Task 2 moves `resume-args.ts` into `common/`.

## Deferred to Slice 2 (explicitly out of scope here)

- Rerouting the Agent-terminal launch (`claude-terminal-manager.ts`) through the adapter — it gains purpose only when a second harness exists to switch to.
- The `spexr.agent.harness` preference, auto-detect UI, and "Switch Agent Harness" command.
- **Warn** when the user explicitly set `spexr.agent.harness` to a harness that is not installed (today `resolveActiveHarness` silently falls back). This becomes a Slice 2 acceptance criterion.

---

### Task 1: `HarnessAdapter` interface + `HarnessId`

**Files:**
- Create: `packages/theia-extensions/src/common/harness/harness-types.ts`
- Test: `packages/theia-extensions/src/common/harness/harness-types.test.ts`

**Interfaces:**
- Produces: `type HarnessId = "claude" | "opencode"`; `interface HarnessAdapter` with `id: HarnessId`, `processNames(): string[]`, `isResumableId(sessionId: string): boolean`, `buildResumeArgs(sessionId: string, fork: boolean): string[]`. (Launch/session/memory members arrive in later slices; keep it minimal to avoid dead stubs.)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import type { HarnessAdapter, HarnessId } from "./harness-types.js";

describe("harness-types", () => {
  test("a fully-implemented adapter satisfies the interface shape", () => {
    const fake: HarnessAdapter = {
      id: "claude",
      processNames: () => ["claude"],
      isResumableId: (s) => s.length > 0,
      buildResumeArgs: (s, fork) => (fork ? ["--resume", s, "--fork-session"] : ["--resume", s]),
    };
    const id: HarnessId = fake.id;
    expect(id).toBe("claude");
    expect(fake.processNames()).toEqual(["claude"]);
    expect(fake.buildResumeArgs("x", true)).toEqual(["--resume", "x", "--fork-session"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/common/harness/harness-types.test.ts`
Expected: FAIL — cannot find module `./harness-types.js`.

- [ ] **Step 3: Write the interface**

```ts
/** The set of agent CLIs SPEXR can drive. */
export type HarnessId = "claude" | "opencode";

/**
 * Abstraction over an agent harness (Claude Code, opencode). Captures the points
 * where SPEXR previously assumed the `claude` CLI. Slice 1 defines only the
 * members needed to route today's Claude logic; launch, session-history, and
 * memory members are added by later slices.
 */
export interface HarnessAdapter {
  /** Stable identifier of this harness. */
  readonly id: HarnessId;
  /** Process command names (`ps -Ao pid,comm`) that indicate a live session. */
  processNames(): string[];
  /** Whether a string is a resumable session id for this harness. */
  isResumableId(sessionId: string): boolean;
  /** CLI args to resume the given (already-validated) session id. */
  buildResumeArgs(sessionId: string, fork: boolean): string[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/common/harness/harness-types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/common/harness/harness-types.ts packages/theia-extensions/src/common/harness/harness-types.test.ts
git commit -m "feat(harness): add HarnessAdapter interface and HarnessId"
```

---

### Task 2: Move `resume-args` into `common/` (fix dependency direction)

**Why:** `resume-args.ts` is pure (regex only, zero imports) but lives under `node/darkfactory/`. `ClaudeHarness` (common) and the browser terminal-manager both need it; `common/` importing `node/` is the wrong direction. Move the implementation to `common/harness/` and leave a one-line re-export shim at the old path so the existing test and the browser import keep working unchanged.

**Files:**
- Create: `packages/theia-extensions/src/common/harness/resume-args.ts` (moved implementation)
- Modify: `packages/theia-extensions/src/node/darkfactory/resume-args.ts` → becomes a re-export shim
- (unchanged) `packages/theia-extensions/src/node/darkfactory/resume-args.test.ts` still imports `./resume-args.js`

**Interfaces:**
- Produces (from new path): `isSessionId(sessionId: string): boolean`, `buildResumeArgs(sessionId: string, fork: boolean): string[]` — identical signatures/behavior to today (throws on non-UUID).

- [ ] **Step 1: Create the moved implementation** at `common/harness/resume-args.ts` (verbatim copy of the current body)

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when a string is a Claude session UUID (safe to pass to `claude --resume`). */
export function isSessionId(sessionId: string): boolean {
  return UUID_RE.test(sessionId);
}

/** Args for `claude` to resume a session. Rejects any sessionId that is not a UUID. */
export function buildResumeArgs(sessionId: string, fork: boolean): string[] {
  if (!isSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
  const args = ["--resume", sessionId];
  if (fork) args.push("--fork-session");
  return args;
}
```

- [ ] **Step 2: Replace the old file with a re-export shim** at `node/darkfactory/resume-args.ts`

```ts
// Moved to common/harness so both the node backend and the browser frontend
// import one copy. Re-exported here to keep existing import paths valid.
export { isSessionId, buildResumeArgs } from "../../common/harness/resume-args.js";
```

- [ ] **Step 3: Run the existing test (must pass unchanged, via the shim)**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/node/darkfactory/resume-args.test.ts`
Expected: PASS — the test imports `./resume-args.js`, which now re-exports from common.

- [ ] **Step 4: Commit**

```bash
git add packages/theia-extensions/src/common/harness/resume-args.ts packages/theia-extensions/src/node/darkfactory/resume-args.ts
git commit -m "refactor(harness): move resume-args to common with re-export shim"
```

---

### Task 3: `ClaudeHarness` implementation

**Files:**
- Create: `packages/theia-extensions/src/common/harness/claude-harness.ts`
- Test: `packages/theia-extensions/src/common/harness/claude-harness.test.ts`

**Interfaces:**
- Consumes: `HarnessAdapter` (Task 1); `isSessionId`, `buildResumeArgs` from `./resume-args.js` (Task 2, same dir).
- Produces: `const claudeHarness: HarnessAdapter`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import { claudeHarness } from "./claude-harness.js";

const UUID = "edd149a5-2e9b-4db6-9380-66e962be6802";

describe("claudeHarness", () => {
  test("id and process names", () => {
    expect(claudeHarness.id).toBe("claude");
    expect(claudeHarness.processNames()).toEqual(["claude"]);
  });

  test("resumable id is a UUID", () => {
    expect(claudeHarness.isResumableId(UUID)).toBe(true);
    expect(claudeHarness.isResumableId("not-a-uuid")).toBe(false);
  });

  test("resume args match legacy behavior", () => {
    expect(claudeHarness.buildResumeArgs(UUID, false)).toEqual(["--resume", UUID]);
    expect(claudeHarness.buildResumeArgs(UUID, true)).toEqual(["--resume", UUID, "--fork-session"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/common/harness/claude-harness.test.ts`
Expected: FAIL — cannot find module `./claude-harness.js`.

- [ ] **Step 3: Implement the descriptor**

```ts
import type { HarnessAdapter } from "./harness-types.js";
import { buildResumeArgs, isSessionId } from "./resume-args.js";

/**
 * The Claude Code harness. Delegates to the existing Claude helpers so behavior
 * is identical to the pre-abstraction code; this object is the routing point
 * that later slices sit a second harness beside.
 */
export const claudeHarness: HarnessAdapter = {
  id: "claude",
  processNames: () => ["claude"],
  isResumableId: (sessionId) => isSessionId(sessionId),
  buildResumeArgs: (sessionId, fork) => buildResumeArgs(sessionId, fork),
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/common/harness/claude-harness.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/common/harness/claude-harness.ts packages/theia-extensions/src/common/harness/claude-harness.test.ts
git commit -m "feat(harness): add ClaudeHarness delegating to existing helpers"
```

---

### Task 4: `HarnessRegistry` — detect + active selection

**Files:**
- Create: `packages/theia-extensions/src/common/harness/harness-registry.ts`
- Test: `packages/theia-extensions/src/common/harness/harness-registry.test.ts`

**Interfaces:**
- Consumes: `HarnessAdapter`, `HarnessId` (Task 1).
- Produces:
  - `type DetectFn = (adapter: HarnessAdapter) => boolean`
  - `function installedHarnesses(adapters: HarnessAdapter[], detect: DetectFn): HarnessAdapter[]`
  - `function resolveActiveHarness(adapters: HarnessAdapter[], detect: DetectFn, preferred?: HarnessId): HarnessAdapter | undefined`

Rules: none installed → `undefined`; exactly one → that one (ignore `preferred`); several → `preferred` when installed, else first installed.

- [ ] **Step 1: Write the failing test** (full stub literals — no `as` casts)

```ts
import { describe, expect, test } from "vitest";
import type { HarnessAdapter, HarnessId } from "./harness-types.js";
import { installedHarnesses, resolveActiveHarness } from "./harness-registry.js";

function stub(id: HarnessId): HarnessAdapter {
  return {
    id,
    processNames: () => [id],
    isResumableId: () => true,
    buildResumeArgs: (s) => ["--resume", s],
  };
}
const claude = stub("claude");
const opencode = stub("opencode");
const all = [claude, opencode];
const detect = (ids: string[]) => (a: HarnessAdapter) => ids.includes(a.id);

describe("harness-registry", () => {
  test("none installed → no active", () => {
    expect(installedHarnesses(all, detect([]))).toEqual([]);
    expect(resolveActiveHarness(all, detect([]))).toBeUndefined();
  });

  test("one installed → that one, preference ignored", () => {
    expect(resolveActiveHarness(all, detect(["opencode"]), "claude")).toBe(opencode);
  });

  test("both installed → preferred wins", () => {
    expect(resolveActiveHarness(all, detect(["claude", "opencode"]), "opencode")).toBe(opencode);
  });

  test("both installed, no/invalid preference → first installed", () => {
    expect(resolveActiveHarness(all, detect(["claude", "opencode"]))).toBe(claude);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/common/harness/harness-registry.test.ts`
Expected: FAIL — cannot find module `./harness-registry.js`.

- [ ] **Step 3: Implement the registry**

```ts
import type { HarnessAdapter, HarnessId } from "./harness-types.js";

/** Predicate deciding whether a harness is installed on this machine. */
export type DetectFn = (adapter: HarnessAdapter) => boolean;

/** The subset of `adapters` reported installed by `detect`, order preserved. */
export function installedHarnesses(adapters: HarnessAdapter[], detect: DetectFn): HarnessAdapter[] {
  return adapters.filter((a) => detect(a));
}

/**
 * Resolve the active harness: none installed → undefined; exactly one → that one
 * (preference ignored); several → the preferred one when installed, else the
 * first installed.
 */
export function resolveActiveHarness(
  adapters: HarnessAdapter[],
  detect: DetectFn,
  preferred?: HarnessId,
): HarnessAdapter | undefined {
  const installed = installedHarnesses(adapters, detect);
  if (installed.length === 0) return undefined;
  if (installed.length === 1) return installed[0];
  return installed.find((a) => a.id === preferred) ?? installed[0];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/common/harness/harness-registry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/common/harness/harness-registry.ts packages/theia-extensions/src/common/harness/harness-registry.test.ts
git commit -m "feat(harness): add HarnessRegistry detect/select helpers"
```

---

### Task 5: Parametrize the Darkfactory process scanner by name set

**Files:**
- Modify: `packages/theia-extensions/src/node/darkfactory/process-scanner.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/process-scanner.test.ts`

**Interfaces:**
- Produces: `parseAgentPids(psStdout: string, names: string[]): number[]`. `parseClaudePids(psStdout: string): number[]` becomes a thin wrapper. `liveProjectDirs` gains an optional `names` param defaulting to `["claude"]`.

- [ ] **Step 1: Write the failing test** (append to `process-scanner.test.ts`)

```ts
import { parseAgentPids } from "./process-scanner.js";

describe("parseAgentPids", () => {
  const ps = ["  10 claude", "  20 opencode", "  30 node", "  40 claude"].join("\n");

  test("matches a single name (claude) like the legacy parser", () => {
    expect(parseAgentPids(ps, ["claude"])).toEqual([10, 40]);
  });

  test("matches multiple names (claude + opencode)", () => {
    expect(parseAgentPids(ps, ["claude", "opencode"])).toEqual([10, 20, 40]);
  });

  test("no name matches → empty", () => {
    expect(parseAgentPids(ps, ["ghost"])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/node/darkfactory/process-scanner.test.ts`
Expected: FAIL — `parseAgentPids` is not exported.

- [ ] **Step 3: Implement** — replace the `parseClaudePids` definition with:

```ts
/** PIDs whose process command name (from `ps -Ao pid,comm`) is one of `names`. */
export function parseAgentPids(psStdout: string, names: string[]): number[] {
  const want = new Set(names);
  const pids: number[] = [];
  for (const line of psStdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m && want.has(m[2]!.trim())) pids.push(Number(m[1]));
  }
  return pids;
}

/** Back-compat wrapper: PIDs whose command name is exactly `claude`. */
export function parseClaudePids(psStdout: string): number[] {
  return parseAgentPids(psStdout, ["claude"]);
}
```

Then thread `names` through `liveProjectDirs` (default preserves today's behavior):

```ts
export async function liveProjectDirs(
  deps?: ScannerDeps,
  timeoutMs = 1500,
  names: string[] = ["claude"],
): Promise<Set<string> | null> {
  const runPs = deps?.runPs ?? (() => run("ps", ["-Ao", "pid,comm"], timeoutMs));
  const runLsofCwd =
    deps?.runLsofCwd ?? ((pid: number) => run("lsof", lsofCwdArgs(pid), timeoutMs));
  try {
    const pids = parseAgentPids(await runPs(), names);
    // …rest of the body unchanged…
```

- [ ] **Step 4: Run the file to verify no regression**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/node/darkfactory/process-scanner.test.ts`
Expected: PASS — new `parseAgentPids` tests plus the untouched `parseClaudePids`/`liveProjectDirs` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/process-scanner.ts packages/theia-extensions/src/node/darkfactory/process-scanner.test.ts
git commit -m "feat(darkfactory): parametrize process scanner by agent name set"
```

---

### Task 6: Wire `claudeHarness` into live call sites (no dead code)

Two edits, behavior identical, covered by existing tests.

**Files:**
- Modify: `packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts`
- Modify: `packages/theia-extensions/src/browser/darkfactory/darkfactory-terminal-manager.ts`

**Interfaces:**
- Consumes: `claudeHarness` (Task 3).

- [ ] **Step 1: Backend — feed the scanner from the harness.** In `spexr-darkfactory-backend-service.ts`, add the import and change the `liveDirs` default so the process-name set comes from `claudeHarness` (value is `["claude"]`, unchanged):

```ts
import { claudeHarness } from "../../common/harness/claude-harness.js";
```

Change the constructor default:
```ts
    // before:
    // this.liveDirs = d.liveProjectDirs ?? (() => defaultLiveProjectDirs());
    // after:
    this.liveDirs =
      d.liveProjectDirs ?? (() => defaultLiveProjectDirs(undefined, undefined, claudeHarness.processNames()));
```

- [ ] **Step 2: Browser — replace the inline resume dup with the harness.** In `darkfactory-terminal-manager.ts`, delete the local `UUID_RE`, `isSessionId`, and `buildResumeArgs` (lines 10-22) and import the harness instead:

```ts
import { claudeHarness } from "../../common/harness/claude-harness.js";
```

Update the two call sites:
```ts
// line ~70 guard:
if (!claudeHarness.isResumableId(sessionId) || !projectPath) return undefined;
// line ~77 args:
...this.resolveShell(claudeHarness.buildResumeArgs(sessionId, fork), dir, projectPath),
```

(The `isResumableId` guard runs before `buildResumeArgs`, so the throw-on-invalid path is never hit — behavior identical to the old non-validating inline version.)

- [ ] **Step 3: Run the darkfactory backend + related tests**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/node/darkfactory`
Expected: PASS — `spexr-darkfactory-backend-service.test.ts` and the scanner tests are unchanged and green.

- [ ] **Step 4: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts packages/theia-extensions/src/browser/darkfactory/darkfactory-terminal-manager.ts
git commit -m "refactor(darkfactory): route live-scan + resume through claudeHarness"
```

---

### Task 7: Regression gate + dead-code check

**Files:** none (verification only).

- [ ] **Step 1: Confirm the abstraction is referenced from live src (not just tests)**

Run: `grep -rn "claudeHarness" packages/theia-extensions/src --include='*.ts' | grep -v ".test.ts" | grep -v "common/harness/"`
Expected: at least the two Task 6 call sites (backend service + terminal manager). If empty, the slice has dead code — fix before proceeding.

- [ ] **Step 2: Typecheck the package**

Run: `cd packages/theia-extensions && pnpm run typecheck`
Expected: no errors.

- [ ] **Step 3: Run the full package test suite**

Run: `cd packages/theia-extensions && pnpm exec vitest run`
Expected: all pre-existing tests pass **unchanged**, plus the new harness + scanner tests.

- [ ] **Step 4: Lint**

Run: `cd packages/theia-extensions && pnpm run lint`
Expected: clean.

- [ ] **Step 5: Commit any lint/format fixups (skip if nothing changed)**

```bash
git add -A && git commit -m "chore(harness): lint/format fixups for slice 1"
```

---

## Self-review notes

- **Spec coverage (Slice 1 / 0012):** interface (T1), dependency-direction fix (T2), `ClaudeHarness` (T3), `HarnessRegistry` (T4), scanner parametrization (T5), live wiring / no-dead-code (T6), regression + dead-code gate (T7).
- **No placeholders:** every code step contains actual code.
- **Type consistency:** `HarnessAdapter`/`HarnessId`, `isResumableId`/`buildResumeArgs(sessionId, fork)`, `parseAgentPids(psStdout, names)`, `resolveActiveHarness(adapters, detect, preferred?)` are identical across every referencing task.
- **Dependency direction:** after T2, `common/` imports nothing from `node/`; the browser and backend both import the harness from `common/`.
- **No unsafe casts:** registry test uses full stub literals via `stub(id)`.
