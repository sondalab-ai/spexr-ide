# Multi-harness Slice 1 — HarnessAdapter extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the `HarnessAdapter` seam and a `ClaudeHarness` implementation behind it, plus a `HarnessRegistry` that detects installed harnesses and resolves the active one — with **zero observable behavior change** — so later slices can add `OpencodeHarness`.

**Architecture:** A process-agnostic `HarnessAdapter` interface lives in `common/harness/`. `ClaudeHarness` implements it by delegating to the existing Claude functions (no logic rewrite). `HarnessRegistry` is a pure module (injected `detectInstalled` seam) that returns installed adapters and resolves the active one from a harness id. The one hardcoded process-name check in the Darkfactory scanner (`parseClaudePids`) is parametrized to a name set — the single spot that genuinely blocks opencode later and is cheap and testable now.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), Vitest, Inversify (Theia DI). No new dependencies.

## Scope refinement vs. design

The design's Slice 1 said "route all Claude call sites." This plan **defers the browser terminal-manager rerouting** (`claude-terminal-manager.ts`, `darkfactory-terminal-manager.ts`) to **Slice 2**, where the harness switch gives that rerouting an actual purpose and test surface. Rerouting those managers now — with only one harness installed — is pure churn with no behavior to verify. Slice 1 therefore delivers: the interface, `ClaudeHarness`, `HarnessRegistry` (all tested), and the parametrized scanner. This is rollback-friendly and leaves `main`'s behavior identical.

## Global Constraints

- **No behavior change.** `ClaudeHarness` must return exactly what today's code computes. Existing tests (`process-scanner.test.ts`, `resume-args.test.ts`, `config-dirs.test.ts`, `claude-profile-detector` tests, `spexr-darkfactory-backend-service.test.ts`) must pass **unchanged**.
- **Import specifiers use `.js`** (NodeNext), e.g. `import { X } from "./x.js"`.
- **Vitest** imports: `import { describe, expect, test } from "vitest"`.
- **No `any`.** Match the repo's strict TS style. ~4-line doc comment on each new exported symbol.
- **Harness ids** are the string literals `"claude"` and `"opencode"` (union type `HarnessId`).

---

### Task 1: `HarnessAdapter` interface + `HarnessId`

**Files:**
- Create: `packages/theia-extensions/src/common/harness/harness-types.ts`
- Test: `packages/theia-extensions/src/common/harness/harness-types.test.ts`

**Interfaces:**
- Produces: `type HarnessId = "claude" | "opencode"`; `interface HarnessAdapter` with the Slice-1-relevant members `id: HarnessId`, `processNames(): string[]`, `buildResumeArgs(sessionId: string, fork: boolean): string[]`, `isResumableId(sessionId: string): boolean`. (Launch/session/memory members are added in later slices; keeping the interface minimal now avoids dead stubs.)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import type { HarnessAdapter, HarnessId } from "./harness-types.js";

describe("harness-types", () => {
  test("a minimal adapter satisfies the interface shape", () => {
    const fake: HarnessAdapter = {
      id: "claude",
      processNames: () => ["claude"],
      isResumableId: (s) => s.length > 0,
      buildResumeArgs: (s) => ["--resume", s],
    };
    const id: HarnessId = fake.id;
    expect(id).toBe("claude");
    expect(fake.processNames()).toEqual(["claude"]);
    expect(fake.buildResumeArgs("x", false)).toEqual(["--resume", "x"]);
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
 * Abstraction over an agent harness (Claude Code, opencode). Captures every
 * point where SPEXR previously assumed the `claude` CLI. Slice 1 defines only
 * the members needed to route today's Claude logic; launch, session-history,
 * and memory members are added by later slices.
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

### Task 2: `ClaudeHarness` implementation

**Files:**
- Create: `packages/theia-extensions/src/common/harness/claude-harness.ts`
- Test: `packages/theia-extensions/src/common/harness/claude-harness.test.ts`

**Interfaces:**
- Consumes: `HarnessAdapter`, `HarnessId` (Task 1); the existing pure resume helpers `buildResumeArgs`, `isSessionId` from `../../node/darkfactory/resume-args.js`.
- Produces: `const claudeHarness: HarnessAdapter` (a singleton descriptor object).

**Note:** `resume-args.ts` currently lives under `node/darkfactory/` but imports nothing node-only (it is a pure regex module), so importing it from `common/` is safe. Do **not** move the file in this slice — importing it in place keeps the diff minimal and the existing test valid.

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

  test("resume args match legacy buildResumeArgs", () => {
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
import { buildResumeArgs, isSessionId } from "../../node/darkfactory/resume-args.js";

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

### Task 3: `HarnessRegistry` — detect + active selection

**Files:**
- Create: `packages/theia-extensions/src/common/harness/harness-registry.ts`
- Test: `packages/theia-extensions/src/common/harness/harness-registry.test.ts`

**Interfaces:**
- Consumes: `HarnessAdapter`, `HarnessId` (Task 1).
- Produces:
  - `type DetectFn = (adapter: HarnessAdapter) => boolean`
  - `function installedHarnesses(adapters: HarnessAdapter[], detect: DetectFn): HarnessAdapter[]`
  - `function resolveActiveHarness(adapters: HarnessAdapter[], detect: DetectFn, preferred?: HarnessId): HarnessAdapter | undefined`

Selection rules (mirror the design): none installed → `undefined`; exactly one installed → that one (ignore `preferred`); several installed → the `preferred` one if installed, else the first installed.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, test } from "vitest";
import type { HarnessAdapter } from "./harness-types.js";
import { installedHarnesses, resolveActiveHarness } from "./harness-registry.js";

const claude = { id: "claude" } as HarnessAdapter;
const opencode = { id: "opencode" } as HarnessAdapter;
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

### Task 4: Parametrize the Darkfactory process scanner by name set

**Files:**
- Modify: `packages/theia-extensions/src/node/darkfactory/process-scanner.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/process-scanner.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `parseAgentPids(psStdout: string, names: string[]): number[]`. `parseClaudePids(psStdout: string): number[]` is kept as a thin wrapper (`parseAgentPids(s, ["claude"])`) so its existing test and any callers stay valid. `liveProjectDirs` gains an optional `names` parameter defaulting to `["claude"]`.

Current `parseClaudePids` body (to replace):
```ts
export function parseClaudePids(psStdout: string): number[] {
  const pids: number[] = [];
  for (const line of psStdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m && m[2]!.trim() === "claude") pids.push(Number(m[1]));
  }
  return pids;
}
```

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

- [ ] **Step 3: Implement the parametrized parser**

Replace the `parseClaudePids` definition with:
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

Then update `liveProjectDirs` to accept the name set (default preserves today's behavior):
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
    // …unchanged body…
```

- [ ] **Step 4: Run the full darkfactory test file to verify no regression**

Run: `cd packages/theia-extensions && pnpm exec vitest run src/node/darkfactory/process-scanner.test.ts`
Expected: PASS — new `parseAgentPids` tests **and** the untouched `parseClaudePids`/`liveProjectDirs` tests.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/process-scanner.ts packages/theia-extensions/src/node/darkfactory/process-scanner.test.ts
git commit -m "feat(darkfactory): parametrize process scanner by agent name set"
```

---

### Task 5: Full-suite + typecheck regression gate

**Files:** none (verification only).

- [ ] **Step 1: Typecheck the package**

Run: `cd packages/theia-extensions && pnpm exec tsc --noEmit -p .`
Expected: no errors.

- [ ] **Step 2: Run the full test suite**

Run: `cd packages/theia-extensions && pnpm exec vitest run`
Expected: all pre-existing tests pass **unchanged**, plus the new harness + scanner tests.

- [ ] **Step 3: Lint the touched files**

Run: `cd packages/theia-extensions && pnpm exec eslint src/common/harness src/node/darkfactory/process-scanner.ts`
Expected: clean.

- [ ] **Step 4: Commit any lint/format fixups (if the previous step changed files)**

```bash
git add -A && git commit -m "chore(harness): lint/format fixups for slice 1"
```

(Skip this commit if nothing changed.)

---

## Self-review notes

- **Spec coverage (Slice 1):** interface (Task 1), `ClaudeHarness` (Task 2), `HarnessRegistry` detect/select (Task 3), scanner parametrization (Task 4), no-behavior-change gate (Task 5). Browser terminal-manager rerouting is explicitly deferred to Slice 2 (see "Scope refinement").
- **No placeholders:** every code step contains the actual code.
- **Type consistency:** `HarnessAdapter`/`HarnessId` names, `buildResumeArgs(sessionId, fork)` signature, and `parseAgentPids(psStdout, names)` signature are identical across all tasks that reference them.
- **Cross-process safety:** `resume-args.ts` is pure (regex only), so `common/` importing it in place introduces no node-only code into a shared module. The interface itself is type-only.
