# Darkfactory v2 (Agent Wall) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape Darkfactory from a grouped list into an agent **monitoring wall** — glanceable semantic status tiles with attention routing, plus a focus mode that opens an interactive `claude --resume` terminal (idle sessions) or a read-only live transcript follow (sessions live elsewhere).

**Architecture:** Rework the backend liveness from `lsof`-on-transcript (proven non-functional) to `ps` + `lsof -p <pid> -d cwd` process scanning at project granularity, combined with transcript modified time. Distill a one-line action per session heuristically from the transcript. The frontend renders a tile grid sorted by attention; a focus pane hosts either a session-keyed embedded terminal (generalizing spec `0003-terminal-agent-surface` to N terminals) or a read-only follow.

**Tech Stack:** TypeScript, Theia (Inversify DI, `RpcConnectionHandler`/`createProxy`, `ReactWidget`, `TerminalService`), Node (`child_process` execFile for `ps`/`lsof`, `fs.watch`), Vitest.

**Branch:** `feat/darkfactory` (worktree `/Users/marcello.barile/src/mine/spexr-darkfactory`). v1 is on this branch and **not** merged, so v2 rewrites it in place with no backward-compat shims.

## Global Constraints

- Repo test runner is **Vitest** (not Jest). Follow sibling `*.test.ts` conventions.
- Theia DI only in `theia-extensions/src/node` + `src/browser`; pure modules stay framework-agnostic.
- Process spawning uses `execFile` with array args — never a shell. `claude --resume` passes the sessionId as an array arg, validated against a UUID shape and the known-sessions set before launch.
- Liveness is **project granularity**: a live `claude` process is attributed to its cwd (project); the project's most-recently-written transcript is the "working" session. Document this; do not imply exact per-session process mapping.
- Graceful degradation: `ps`/`lsof` unavailable → modified-time recency only; missing `~/.claude/projects` → empty; model/enrichment unavailable → heuristic action line stands alone.
- Distilled action line is **heuristic (tool-based, zero-latency)** on the hot path; the Qwen summary is optional enrichment only, never blocking a tile render.
- Non-parseable transcript lines are skipped, never fatal.
- Product code/comments in English; permission-mode/mode rendered with human labels, never bare tokens.
- Reduced-motion: all attention motion respects `prefers-reduced-motion`.

---

## Reuse from v1 (already on the branch)

- **Keep:** `transcript-parser.ts`, `turns.ts`, the Qwen `summarize` worker extension, `darkfactory-format.ts` (extend), the RPC proxy/client dispatcher pattern.
- **Rework:** `common/darkfactory-protocol.ts` (richer tile), `spexr-darkfactory-backend-service.ts` (new liveness + distillation + tail + terminal launch).
- **Replace:** `open-transcripts.ts` (lsof-on-transcript) → `process-scanner.ts`. Delete `open-transcripts.ts` and its test.
- **Replace:** `darkfactory-widget.tsx` (list) → `darkfactory-wall-widget.tsx` + `agent-tile.tsx` + `focus-pane.tsx`.

---

## Slice 1 — Wall MVP (reworked liveness + semantic tiles + attention sort)

> **Task ordering:** Task 2 (`session-state`) and Task 4 (formatters) import the v2 `AgentState` /
> `AgentTile` from the protocol, which Task 5 reworks. **Implement Task 5 before Tasks 2 and 4.**
> A safe order for this slice: Task 1 → Task 5 → Task 2 → Task 3 → Task 4 → Task 6 → Task 7.

### Task 1: Process scanner

**Files:**
- Create: `packages/theia-extensions/src/node/darkfactory/process-scanner.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/process-scanner.test.ts`
- Delete: `packages/theia-extensions/src/node/darkfactory/open-transcripts.ts` and `open-transcripts.test.ts`

**Interfaces:**
- Produces: `parseClaudePids(psStdout: string): number[]`, `parseCwd(lsofStdout: string): string | undefined`, and `liveProjectDirs(deps?): Promise<Set<string> | null>` (the set of cwds of running `claude` processes, or `null` on failure).

- [ ] **Step 1: Write the failing test**

```ts
import { parseClaudePids, parseCwd, liveProjectDirs } from "./process-scanner.js";

test("parseClaudePids keeps pids whose comm is exactly 'claude'", () => {
  const ps = [
    "  PID COMM",
    " 2098 claude",
    " 2175 node",
    " 2624 claude",
  ].join("\n");
  expect(parseClaudePids(ps)).toEqual([2098, 2624]);
});

test("parseCwd reads the n-prefixed cwd line from lsof -Fn", () => {
  expect(parseCwd("p2098\nfcwd\nn/Users/x/src/proj\n")).toBe("/Users/x/src/proj");
  expect(parseCwd("p2098\nfcwd\n")).toBeUndefined();
});

test("liveProjectDirs returns the set of claude cwds", async () => {
  const set = await liveProjectDirs({
    runPs: () => Promise.resolve(" PID COMM\n 10 claude\n 11 claude\n"),
    runLsofCwd: (pid) => Promise.resolve(`p${pid}\nfcwd\nn/proj/${pid}\n`),
  });
  expect(set).toEqual(new Set(["/proj/10", "/proj/11"]));
});

test("liveProjectDirs returns null when ps fails", async () => {
  const set = await liveProjectDirs({ runPs: () => Promise.reject(new Error("no ps")), runLsofCwd: async () => "" });
  expect(set).toBeNull();
});
```

- [ ] **Step 2: Run it — Expected: FAIL (module not found)**

Run: `cd packages/theia-extensions && npx vitest run process-scanner`

- [ ] **Step 3: Implement**

```ts
import { execFile } from "node:child_process";

/** Injectable runners so tests never spawn real processes. */
export interface ScannerDeps {
  runPs: () => Promise<string>;
  runLsofCwd: (pid: number) => Promise<string>;
}

/** PIDs whose process command name is exactly `claude` (from `ps -Ao pid,comm`). */
export function parseClaudePids(psStdout: string): number[] {
  const pids: number[] = [];
  for (const line of psStdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m && m[2]!.trim() === "claude") pids.push(Number(m[1]));
  }
  return pids;
}

/** Working directory from `lsof -p <pid> -d cwd -Fn` output (the `n`-prefixed line). */
export function parseCwd(lsofStdout: string): string | undefined {
  for (const line of lsofStdout.split("\n")) {
    if (line.startsWith("n")) return line.slice(1);
  }
  return undefined;
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout) => {
      if (err && !stdout) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Working directories of all running `claude` processes, or `null` when
 * detection failed (caller falls back to modified-time-only liveness).
 */
export async function liveProjectDirs(deps?: ScannerDeps, timeoutMs = 1500): Promise<Set<string> | null> {
  const runPs = deps?.runPs ?? (() => run("ps", ["-Ao", "pid,comm"], timeoutMs));
  const runLsofCwd = deps?.runLsofCwd ?? ((pid: number) => run("lsof", ["-p", String(pid), "-d", "cwd", "-Fn"], timeoutMs));
  try {
    const pids = parseClaudePids(await runPs());
    const dirs = new Set<string>();
    await Promise.all(
      pids.map(async (pid) => {
        try {
          const cwd = parseCwd(await runLsofCwd(pid));
          if (cwd) dirs.add(cwd);
        } catch { /* skip this pid */ }
      }),
    );
    return dirs;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run it — Expected: PASS (4 tests)**

Run: `cd packages/theia-extensions && npx vitest run process-scanner`

- [ ] **Step 5: Delete the obsolete lsof-on-transcript module**

```bash
git rm packages/theia-extensions/src/node/darkfactory/open-transcripts.ts packages/theia-extensions/src/node/darkfactory/open-transcripts.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/process-scanner.ts packages/theia-extensions/src/node/darkfactory/process-scanner.test.ts
git commit -m "feat(darkfactory): scan running claude processes by cwd (replaces lsof-on-transcript)"
```

### Task 2: Session state

**Files:**
- Create: `packages/theia-extensions/src/node/darkfactory/session-state.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/session-state.test.ts`

**Interfaces:**
- Consumes: `AgentState` from the protocol (Task 5 reworks it to `"working" | "idle" | "done"`; land Task 5 before this or define locally and re-export — this plan imports it from the protocol).
- Produces: `classifySession(projectPath, mtimeMs, isNewestInProject, liveDirs, nowMs, workingWindowMs): AgentState`.

- [ ] **Step 1: Write the failing test**

```ts
import { classifySession } from "./session-state.js";

const WORKING_WINDOW = 45_000;
const NOW = 1_000_000_000_000;

test("working: live process in project AND newest transcript AND recent write", () => {
  expect(classifySession("/p", NOW - 10_000, true, new Set(["/p"]), NOW, WORKING_WINDOW)).toBe("working");
});

test("idle: recent write but no live process in project", () => {
  expect(classifySession("/p", NOW - 10_000, true, new Set(), NOW, WORKING_WINDOW)).toBe("idle");
});

test("idle: live process but this session is not the newest in its project", () => {
  expect(classifySession("/p", NOW - 10_000, false, new Set(["/p"]), NOW, WORKING_WINDOW)).toBe("idle");
});

test("done: old write, no live process", () => {
  expect(classifySession("/p", NOW - 10 * 3_600_000, true, new Set(), NOW, WORKING_WINDOW)).toBe("done");
});

test("null liveDirs (scan failed) never yields working", () => {
  expect(classifySession("/p", NOW - 1_000, true, null, NOW, WORKING_WINDOW)).toBe("idle");
});
```

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `cd packages/theia-extensions && npx vitest run session-state`

- [ ] **Step 3: Implement**

```ts
import type { AgentState } from "../../common/darkfactory-protocol.js";

const IDLE_WINDOW_MS = 12 * 3_600_000;

/**
 * Classify a session at project granularity.
 * - working: a live `claude` process runs in the project, this is the project's
 *   newest transcript, and it was written within `workingWindowMs`.
 * - idle: written within the idle window but not currently working.
 * - done: older, not working.
 * `liveDirs` is `null` when process scanning failed → never "working".
 */
export function classifySession(
  projectPath: string,
  mtimeMs: number,
  isNewestInProject: boolean,
  liveDirs: Set<string> | null,
  nowMs: number,
  workingWindowMs: number,
): AgentState {
  const age = nowMs - mtimeMs;
  const working = !!liveDirs?.has(projectPath) && isNewestInProject && age <= workingWindowMs;
  if (working) return "working";
  if (age <= IDLE_WINDOW_MS) return "idle";
  return "done";
}
```

- [ ] **Step 4: Run it — Expected: PASS (5 tests)**

Run: `cd packages/theia-extensions && npx vitest run session-state`

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/session-state.ts packages/theia-extensions/src/node/darkfactory/session-state.test.ts
git commit -m "feat(darkfactory): classify session working/idle/done by process + mtime"
```

### Task 3: Action distiller

**Files:**
- Create: `packages/theia-extensions/src/node/darkfactory/action-distiller.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/action-distiller.test.ts`

**Interfaces:**
- Consumes: transcript entry objects (loosely typed, like `TurnEntry` in `turns.ts`).
- Produces: `distillAction(entries): { line: string; tool?: string; target?: string }` — a one-line human action derived from the last meaningful transcript entry.

- [ ] **Step 1: Write the failing test**

```ts
import { distillAction } from "./action-distiller.js";

test("last tool_use → verb + target", () => {
  const entries = [
    { message: { role: "assistant", content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/src/auth.ts" } }] } },
  ];
  expect(distillAction(entries)).toEqual({ line: "Editing auth.ts", tool: "Edit", target: "auth.ts" });
});

test("Bash tool → running command", () => {
  const entries = [
    { message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }] } },
  ];
  expect(distillAction(entries)).toEqual({ line: "Running: pnpm test", tool: "Bash", target: "pnpm test" });
});

test("trailing assistant text → thinking/replying", () => {
  const entries = [{ message: { role: "assistant", content: [{ type: "text", text: "Here is the plan for the refactor" }] } }];
  expect(distillAction(entries).line).toMatch(/^Here is the plan/);
});

test("empty transcript → neutral line", () => {
  expect(distillAction([]).line).toBe("No activity yet");
});
```

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `cd packages/theia-extensions && npx vitest run action-distiller`

- [ ] **Step 3: Implement**

```ts
import { basename } from "node:path";

/** One transcript entry, loosely typed (only `message` is read). */
export interface DistillEntry {
  message?: { role?: string; content?: unknown };
}

export interface DistilledAction {
  line: string;
  tool?: string;
  target?: string;
}

const VERB: Record<string, string> = {
  Edit: "Editing", Write: "Writing", Read: "Reading", Bash: "Running",
  Grep: "Searching", Glob: "Finding", Task: "Delegating", WebFetch: "Fetching",
};

function toolTarget(name: string, input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  if (name === "Bash") return typeof input.command === "string" ? input.command : undefined;
  const p = input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.description;
  if (typeof p === "string") return name === "Edit" || name === "Write" || name === "Read" ? basename(p) : p;
  return undefined;
}

/** Distil the last meaningful transcript entry into one human action line. */
export function distillAction(entries: DistillEntry[]): DistilledAction {
  for (let i = entries.length - 1; i >= 0; i--) {
    const content = entries[i]?.message?.content;
    if (!Array.isArray(content)) {
      if (typeof content === "string" && content.trim()) {
        return { line: content.replace(/\s+/g, " ").trim().slice(0, 80) };
      }
      continue;
    }
    for (let j = content.length - 1; j >= 0; j--) {
      const b = content[j] as { type?: string; name?: string; text?: string; input?: Record<string, unknown> };
      if (b.type === "tool_use" && b.name) {
        const target = toolTarget(b.name, b.input);
        const verb = VERB[b.name] ?? `${b.name}`;
        const line = b.name === "Bash" && target ? `Running: ${target}` : target ? `${verb} ${target}` : verb;
        return { line: line.slice(0, 80), tool: b.name, target };
      }
      if (b.type === "text" && b.text?.trim()) {
        return { line: b.text.replace(/\s+/g, " ").trim().slice(0, 80) };
      }
    }
  }
  return { line: "No activity yet" };
}
```

- [ ] **Step 4: Run it — Expected: PASS (4 tests)**

Run: `cd packages/theia-extensions && npx vitest run action-distiller`

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/action-distiller.ts packages/theia-extensions/src/node/darkfactory/action-distiller.test.ts
git commit -m "feat(darkfactory): distil a one-line action from the transcript"
```

### Task 4: Extend formatters (attention sort + permission labels)

**Files:**
- Modify: `packages/theia-extensions/src/browser/darkfactory/darkfactory-format.ts`
- Modify: `packages/theia-extensions/src/browser/darkfactory/darkfactory-format.test.ts`

**Interfaces:**
- Produces: `attentionRank(state, needsYou): number`, `sortTiles(tiles): AgentTile[]` (needs-you → working → idle → done), `permissionLabel(mode): string`, `modeLabel(mode): string | undefined`.

- [ ] **Step 1: Write the failing test** (append to the existing describe)

```ts
import { sortTiles, permissionLabel, modeLabel } from "./darkfactory-format.js";
import type { AgentTile } from "../../common/darkfactory-protocol.js";

test("sortTiles orders needs-you, working, idle, done", () => {
  const t = (id: string, state: AgentTile["state"], needsYou = false): AgentTile =>
    ({ sessionId: id, projectPath: "/p", projectName: "p", transcriptPath: "/p/" + id, state, needsYou,
       actionLine: "", lastActivityMs: 0, accentId: 0 } as AgentTile);
  const out = sortTiles([t("a", "done"), t("b", "working"), t("c", "idle", true), t("d", "working", true)]);
  expect(out.map((x) => x.sessionId)).toEqual(["c", "d", "b", "a"]);
});

test("permissionLabel maps modes to human copy", () => {
  expect(permissionLabel("auto")).toBe("Auto-approve tools");
  expect(permissionLabel("default")).toBe("Ask each time");
  expect(permissionLabel("plan")).toBe("Plan mode");
});

test("modeLabel hides the default mode", () => {
  expect(modeLabel("normal")).toBeUndefined();
  expect(modeLabel("accept-edits")).toBe("Accept edits");
});
```

Note: the needs-you tiles sort before others but keep their own relative state order (`c` idle+needsYou before `d` working+needsYou because needs-you is the top bucket, then ordered by state within — adjust the expected array to your final rule and keep the test asserting it explicitly).

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `cd packages/theia-extensions && npx vitest run darkfactory-format`

- [ ] **Step 3: Implement** (add to the file)

```ts
import type { AgentTile, AgentState } from "../../common/darkfactory-protocol.js";

const STATE_RANK: Record<AgentState, number> = { working: 0, idle: 1, done: 2 };

/** Lower = higher attention. Needs-you always outranks state. */
export function attentionRank(state: AgentState, needsYou: boolean): number {
  return (needsYou ? 0 : 1) * 10 + STATE_RANK[state];
}

/** Needs-you → working → idle → done, then most-recently-active first. */
export function sortTiles(tiles: AgentTile[]): AgentTile[] {
  return [...tiles].sort(
    (a, b) =>
      attentionRank(a.state, a.needsYou) - attentionRank(b.state, b.needsYou) ||
      b.lastActivityMs - a.lastActivityMs,
  );
}

export function permissionLabel(mode: string | undefined): string {
  switch (mode) {
    case "auto": return "Auto-approve tools";
    case "plan": return "Plan mode";
    case "default": return "Ask each time";
    default: return mode ? mode : "Ask each time";
  }
}

/** Human label for non-default `mode`; undefined for the default so it's hidden. */
export function modeLabel(mode: string | undefined): string | undefined {
  if (!mode || mode === "normal") return undefined;
  return mode.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}
```

- [ ] **Step 4: Run it — Expected: PASS**

Run: `cd packages/theia-extensions && npx vitest run darkfactory-format`

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/browser/darkfactory/darkfactory-format.ts packages/theia-extensions/src/browser/darkfactory/darkfactory-format.test.ts
git commit -m "feat(darkfactory): attention-sort tiles and humanise permission/mode labels"
```

### Task 5: Rework the protocol for tiles

**Files:**
- Modify: `packages/theia-extensions/src/common/darkfactory-protocol.ts`

**Interfaces:**
- Produces: `AgentState = "working" | "idle" | "done"`; `AgentTile` (sessionId, transcriptPath, projectPath, projectName, state, needsYou, needsYouCertain, actionLine, tool?, target?, gitBranch?, mode?, permissionMode?, lastActivityMs, turnCount, accentId); reworked `SpexrDarkfactoryService` (`listTiles()`, `openAgent(sessionId)`, follow subscription) and `SpexrDarkfactoryClient` (`onTilesChanged`, `onFollowChunk`). Keep the service path constant.

- [ ] **Step 1: Rewrite the protocol** (replace v1 types)

```ts
export const DARKFACTORY_SERVICE_PATH = "/services/spexr-darkfactory";

export type AgentState = "working" | "idle" | "done";

/** How the focus pane should present a session. */
export type FocusKind = "resume-terminal" | "readonly-follow";

/** One agent session as shown on a wall tile. */
export interface AgentTile {
  sessionId: string;
  transcriptPath: string;
  projectPath: string;
  projectName: string;
  state: AgentState;
  /** True when the agent appears to be waiting for user input. */
  needsYou: boolean;
  /** False when needsYou is a best-effort guess (external agent). */
  needsYouCertain: boolean;
  /** One-line distilled current action. */
  actionLine: string;
  tool?: string;
  target?: string;
  gitBranch?: string;
  mode?: string;
  permissionMode?: string;
  lastActivityMs: number;
  turnCount: number;
  /** Stable index into the frontend accent palette, derived from projectPath. */
  accentId: number;
}

/** How the frontend should open a session in the focus pane. */
export interface FocusPlan {
  sessionId: string;
  projectPath: string;
  kind: FocusKind;
}

export interface SpexrDarkfactoryService {
  listTiles(): Promise<AgentTile[]>;
  /** Decide whether a session opens as an interactive resume terminal or a read-only follow. */
  planFocus(sessionId: string): Promise<FocusPlan>;
  /** Begin streaming transcript turns for a read-only follow; idempotent per session. */
  startFollow(sessionId: string): Promise<void>;
  stopFollow(sessionId: string): Promise<void>;
}

export interface SpexrDarkfactoryClient {
  onTilesChanged(tiles: AgentTile[]): void;
  onFollowChunk(sessionId: string, turns: string): void;
}
```

- [ ] **Step 2: Typecheck** (will fail in v1 consumers — expected; later tasks fix them)

Run: `cd packages/theia-extensions && npx tsc --noEmit 2>&1 | head`
Expected: errors only in `spexr-darkfactory-backend-service.ts`, `darkfactory-widget.tsx`, `darkfactory-client.ts` (rewritten in Tasks 6–9). Note them; do not fix here.

- [ ] **Step 3: Commit**

```bash
git add packages/theia-extensions/src/common/darkfactory-protocol.ts
git commit -m "feat(darkfactory): rework protocol around attention tiles and focus plans"
```

### Task 6: Rework the backend service (tiles)

**Files:**
- Modify: `packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts`
- Modify: `packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.test.ts`

**Interfaces:**
- Consumes: `parseTranscript` (v1), `liveProjectDirs` (Task 1), `classifySession` (Task 2), `distillAction` (Task 3), protocol tiles (Task 5).
- Produces: `SpexrDarkfactoryBackendService implements SpexrDarkfactoryService` — `listTiles`, `planFocus`, `startFollow`/`stopFollow`, `setClient`, plus the scan/watch machinery. Keep the constructor test-seam pattern from v1 (`DarkfactoryDeps` with `now`, `projectsDir`, `listTranscripts`, and a `liveProjectDirs` override).

- [ ] **Step 1: Write the failing test** (rewrite v1's test)

```ts
import { describe, expect, it } from "vitest";
import { SpexrDarkfactoryBackendService } from "./spexr-darkfactory-backend-service.js";

const NOW = 100 * 3_600_000;

function svc(over: Partial<ConstructorParameters<typeof SpexrDarkfactoryBackendService>[0]> = {}) {
  return new SpexrDarkfactoryBackendService({
    projectsDir: "/PD",
    now: () => NOW,
    listTranscripts: () => Promise.resolve([
      { sessionId: "s1", transcriptPath: "/PD/-proj/s1.jsonl", mtimeMs: NOW - 5_000,
        readLines: () => Promise.resolve([`{"cwd":"/Users/x/src/proj","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit","input":{"file_path":"/x/auth.ts"}}]}}`]) },
    ]),
    liveProjectDirs: () => Promise.resolve(new Set(["/Users/x/src/proj"])),
    ...over,
  });
}

describe("SpexrDarkfactoryBackendService v2", () => {
  it("listTiles builds a working tile with a distilled action", async () => {
    const tiles = await svc().listTiles();
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      sessionId: "s1", projectName: "proj", state: "working",
      actionLine: "Editing auth.ts", tool: "Edit",
    });
    expect(typeof tiles[0]!.accentId).toBe("number");
  });

  it("planFocus returns resume-terminal for an idle session, readonly-follow for a working one", async () => {
    const s = svc();
    await s.listTiles();
    expect((await s.planFocus("s1")).kind).toBe("readonly-follow"); // working elsewhere
    const idle = svc({ liveProjectDirs: () => Promise.resolve(new Set()) });
    await idle.listTiles();
    expect((await idle.planFocus("s1")).kind).toBe("resume-terminal");
  });
});
```

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `cd packages/theia-extensions && npx vitest run spexr-darkfactory-backend-service`

- [ ] **Step 3: Implement** — rework the service. Key points (write the full class, keeping the v1 scan/watch/debounce helpers):
  - `listTiles()`: scan transcripts; for each project compute the newest transcript (max mtime) so `isNewestInProject` can be passed to `classifySession`; parse each transcript once; call `distillAction` on the parsed entries; compute `accentId = hashToIndex(projectPath, PALETTE_SIZE)`; assemble `AgentTile`. Track a `sessionId → { transcriptPath, projectPath, state, mtimeMs }` index for `planFocus`/follow. Use conditional spreads for optional fields (`exactOptionalPropertyTypes`).
  - `planFocus(sessionId)`: `kind = index.state === "working" ? "readonly-follow" : "resume-terminal"` (a session that is working — i.e. live elsewhere — is followed read-only; idle/done resumes).
  - `startFollow(sessionId)`: `fs.watch` the transcript; on change, read newly-appended lines, build turns text (reuse `buildTurnsText`), and `this.client?.onFollowChunk(sessionId, turns)`. `stopFollow`: close that watcher. Track watchers in a `Map<string, FSWatcher>`.
  - `liveProjectDirs` uses the injected override or the real `process-scanner` `liveProjectDirs`.
  - Keep `setClient`, the projects-dir `fs.watch` → `onTilesChanged`, and graceful degradation from v1.

  Provide a `hashToIndex(s: string, n: number): number` helper (simple 32-bit string hash mod n) and `const PALETTE_SIZE = 8`.

- [ ] **Step 4: Run it — Expected: PASS (2 tests)**

Run: `cd packages/theia-extensions && npx vitest run spexr-darkfactory-backend-service`

- [ ] **Step 5: Full suite + typecheck (backend now consistent)**

Run: `cd packages/theia-extensions && npx vitest run darkfactory && npx tsc --noEmit 2>&1 | grep -v "widget\|darkfactory-client" | grep "error TS" | head`
Expected: darkfactory tests pass; remaining tsc errors only in the frontend files rewritten in Tasks 7–9.

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.test.ts
git commit -m "feat(darkfactory): build attention tiles, plan focus, stream follows"
```

### Task 7: Wall widget + tile component

**Files:**
- Create: `packages/theia-extensions/src/browser/darkfactory/agent-tile.tsx`
- Rewrite: `packages/theia-extensions/src/browser/darkfactory/darkfactory-widget.tsx` → rename to `darkfactory-wall-widget.tsx` (keep the exported class name `SpexrDarkfactoryWidget` and `static ID` so the frontend-module and view-contribution bindings are unchanged)
- Modify: `packages/theia-extensions/src/browser/darkfactory/darkfactory-client.ts` (add `onFollowChunk` + `onTilesChanged`)
- Modify: `packages/theia-extensions/src/browser/style/spexr.css` (replace the v1 `.spexr-df-*` block with the wall styles)

**Interfaces:**
- Consumes: `sortTiles`, `permissionLabel`, `modeLabel`, `relativeTime` (Task 4); `SpexrDarkfactoryServiceProxy`, `SpexrDarkfactoryClientDispatcher`; protocol `AgentTile`.
- Produces: `SpexrDarkfactoryWidget` rendering the tile grid; `AgentTile` React component.

- [ ] **Step 1: Update the client dispatcher**

```ts
// darkfactory-client.ts — replace the single emitter with two.
import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { SpexrDarkfactoryClient, AgentTile } from "../../common/darkfactory-protocol.js";

export const SpexrDarkfactoryClientToken = Symbol("SpexrDarkfactoryClientDispatcher");

@injectable()
export class SpexrDarkfactoryClientDispatcher implements SpexrDarkfactoryClient {
  private readonly tiles = new Emitter<AgentTile[]>();
  readonly onTilesChanged$: Event<AgentTile[]> = this.tiles.event;
  private readonly follow = new Emitter<{ sessionId: string; turns: string }>();
  readonly onFollowChunk$: Event<{ sessionId: string; turns: string }> = this.follow.event;

  onTilesChanged(tiles: AgentTile[]): void { this.tiles.fire(tiles); }
  onFollowChunk(sessionId: string, turns: string): void { this.follow.fire({ sessionId, turns }); }
}
```

- [ ] **Step 2: Write the tile component** (`agent-tile.tsx`)

```tsx
import * as React from "@theia/core/shared/react";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import { permissionLabel, modeLabel, relativeTime } from "./darkfactory-format.js";

const PERMISSION_ICON: Record<string, string> = {
  auto: "codicon-check-all", plan: "codicon-map", default: "codicon-question",
};

/** One glanceable agent tile. Click selects it for the focus pane. */
export function AgentTileCard(props: { tile: AgentTile; now: number; onOpen: (t: AgentTile) => void }): React.ReactElement {
  const { tile, now, onOpen } = props;
  return (
    <button
      className="spexr-df-tile"
      data-state={tile.state}
      data-needs-you={tile.needsYou ? "1" : "0"}
      style={{ ["--tile-accent" as string]: `var(--spexr-df-accent-${tile.accentId})` }}
      onClick={() => onOpen(tile)}
    >
      <span className="spexr-df-tile__head">
        <span className="spexr-df-tile__led" />
        <span className="spexr-df-tile__project">{tile.projectName}</span>
        {tile.gitBranch && <span className="spexr-df-tile__branch">{tile.gitBranch}</span>}
      </span>
      <span className="spexr-df-tile__action">
        {tile.tool && <span className="spexr-df-tile__chip">{tile.tool}</span>}
        {tile.actionLine}
      </span>
      <span className="spexr-df-tile__meta">
        {tile.needsYou && (
          <span className="spexr-df-tile__needs">
            {tile.needsYouCertain ? "Needs you" : "Maybe waiting"}
          </span>
        )}
        <span className="spexr-df-tile__perm" title={permissionLabel(tile.permissionMode)}>
          <i className={`codicon ${PERMISSION_ICON[tile.permissionMode ?? "default"] ?? "codicon-question"}`} />
        </span>
        {modeLabel(tile.mode) && <em>{modeLabel(tile.mode)}</em>}
        <time>{relativeTime(tile.lastActivityMs, now)}</time>
      </span>
    </button>
  );
}
```

- [ ] **Step 3: Write the wall widget** (`darkfactory-wall-widget.tsx`)

Render `sortTiles(this.tiles)` into a responsive grid of `AgentTileCard`. Subscribe to `onTilesChanged$` (push to `this.toDispose`), call `listTiles()` in `init` with `.catch`. On tile open, call a focus handler (Task 8 wires the focus pane; in this task, `onOpen` can call `void this.openFocus(tile)` where `openFocus` is a stub that Task 8 fills). Keep `static ID`/class name identical to v1 so bindings are unchanged. Empty-state message when no tiles.

Provide the full component body mirroring the v1 widget's structure (inject service, client, `@postConstruct init`, `render`), but iterate tiles with `AgentTileCard`. Include the accent CSS variables `--spexr-df-accent-0..7` in the style block (Step 5).

- [ ] **Step 4: Rename & update bindings**

Rename the file to `darkfactory-wall-widget.tsx`. Update the import in `spexr-frontend-module.ts` and `darkfactory-view-contribution.ts` to the new path (class name unchanged). Run:

```bash
git mv packages/theia-extensions/src/browser/darkfactory/darkfactory-widget.tsx packages/theia-extensions/src/browser/darkfactory/darkfactory-wall-widget.tsx
```

- [ ] **Step 5: Replace the CSS block** in `spexr.css` — remove the v1 `.spexr-df-*` rules and add the wall styles: an 8-entry accent palette (`--spexr-df-accent-0..7`), a responsive `grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))`, tile chrome driven by `data-state` and `data-needs-you` (calm border by default; loud accent + `spexr-df-alert` animation when `data-needs-you="1"`), the LED, the tool chip, and `@media (prefers-reduced-motion: reduce)` disabling the alert animation. Reuse existing design tokens (`--spexr-space-*`, `--spexr-text-*`, `--spexr-radius-*`, `--spexr-border-*`, `--spexr-text-muted`).

- [ ] **Step 6: Typecheck + tests**

Run: `cd packages/theia-extensions && npx tsc --noEmit 2>&1 | grep "error TS" | head` (expect 0) and `npx vitest run darkfactory`
Expected: 0 type errors; darkfactory tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/theia-extensions/src
git commit -m "feat(darkfactory): render the attention wall of agent tiles"
```

---

## Slice 2 — Focus mode: interact and follow

### Task 8: Session-keyed resume terminals

**Files:**
- Create: `packages/theia-extensions/src/browser/darkfactory/darkfactory-terminal-manager.ts`
- Create: `packages/theia-extensions/src/node/darkfactory/resume-args.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/resume-args.test.ts`
- Modify: `spexr-frontend-module.ts` (bind the manager)

**Interfaces:**
- Produces: `buildResumeArgs(sessionId, fork): string[]` (pure, validated) and `SpexrDarkfactoryTerminalManager.openResume(sessionId, projectPath, fork)` creating/ revealing a session-keyed `TerminalService` terminal.

- [ ] **Step 1: Write the failing test for `buildResumeArgs`**

```ts
import { buildResumeArgs } from "./resume-args.js";

test("valid uuid → --resume <id>", () => {
  expect(buildResumeArgs("edd149a5-2e9b-4db6-9380-66e962be6802", false)).toEqual(["--resume", "edd149a5-2e9b-4db6-9380-66e962be6802"]);
});

test("fork adds --fork-session", () => {
  expect(buildResumeArgs("edd149a5-2e9b-4db6-9380-66e962be6802", true)).toEqual(["--resume", "edd149a5-2e9b-4db6-9380-66e962be6802", "--fork-session"]);
});

test("non-uuid sessionId is rejected", () => {
  expect(() => buildResumeArgs("; rm -rf /", false)).toThrow();
});
```

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `cd packages/theia-extensions && npx vitest run resume-args`

- [ ] **Step 3: Implement `resume-args.ts`**

```ts
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Args for `claude` to resume a session. Rejects any sessionId that is not a UUID. */
export function buildResumeArgs(sessionId: string, fork: boolean): string[] {
  if (!UUID_RE.test(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
  const args = ["--resume", sessionId];
  if (fork) args.push("--fork-session");
  return args;
}
```

- [ ] **Step 4: Run it — Expected: PASS**

Run: `cd packages/theia-extensions && npx vitest run resume-args`

- [ ] **Step 5: Implement the terminal manager** (`darkfactory-terminal-manager.ts`)

Model it on `ClaudeTerminalManager` (read `packages/theia-extensions/src/browser/agent/claude-terminal-manager.ts` for the exact `TerminalService.newTerminal` options, profile resolution via `SPEXR_CLAUDE_EXECUTABLE_PREFERENCE` / `SPEXR_CLAUDE_CONFIG_DIR_PREFERENCE`, and the `shellQuote`/`resolveShell` pattern), but:
- Keep a `Map<string, TerminalWidget>` keyed by `spexr-df-<sessionId>` so each session gets its own terminal.
- `openResume(sessionId, projectPath, fork)`: reuse the widget if present (reveal it); else `newTerminal({ id: "spexr-df-" + sessionId, title: basename(projectPath), cwd: projectPath, shellArgs: <resolved resume args>, env: <configDir env> })`, then `terminalService.open(widget)` in the **main** area, and `activateWidget`.
- Resume args come from `buildResumeArgs` (imported from the node module is not allowed in browser — instead inline the same UUID guard in the browser manager, or expose a tiny pure browser helper; keep the validation on the browser side too before spawning).
- Dispose entries on widget close.

- [ ] **Step 6: Bind the manager** in `spexr-frontend-module.ts`:

```ts
bind(SpexrDarkfactoryTerminalManager).toSelf().inSingletonScope();
```

- [ ] **Step 7: Typecheck**

Run: `cd packages/theia-extensions && npx tsc --noEmit 2>&1 | grep "error TS" | head`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add packages/theia-extensions/src
git commit -m "feat(darkfactory): open session-keyed claude --resume terminals"
```

### Task 9: Focus pane wiring (resume vs follow)

**Files:**
- Modify: `packages/theia-extensions/src/browser/darkfactory/darkfactory-wall-widget.tsx`
- Create: `packages/theia-extensions/src/browser/darkfactory/follow-pane.tsx`

**Interfaces:**
- Consumes: `SpexrDarkfactoryService.planFocus`/`startFollow`/`stopFollow`, `onFollowChunk$`, `SpexrDarkfactoryTerminalManager`.
- Produces: focus behaviour — on tile open, `planFocus(sessionId)`; if `resume-terminal` → `terminalManager.openResume(...)`; if `readonly-follow` → open the `follow-pane` (a widget or in-widget panel) that subscribes to `onFollowChunk$` for that session and renders streamed turns, with a "Fork & take over" button calling `openResume(sessionId, projectPath, true)`.

- [ ] **Step 1: Implement `follow-pane.tsx`** — a React panel that, given a `sessionId`, calls `startFollow` on mount / `stopFollow` on unmount, accumulates `onFollowChunk$` turns into scrollback, and renders them read-only with a "Fork & take over" action. (Show the full component: subscribe in an effect-like `componentDidMount`/`willUnmount` if class-based, or wire through the parent widget's lifecycle.)

- [ ] **Step 2: Wire `openFocus` in the wall widget**

```ts
private async openFocus(tile: AgentTile): Promise<void> {
  const plan = await this.service.planFocus(tile.sessionId);
  if (plan.kind === "resume-terminal") {
    await this.terminalManager.openResume(plan.sessionId, plan.projectPath, false);
  } else {
    this.openFollowPane(plan);
  }
}
```

Inject `SpexrDarkfactoryTerminalManager`. Implement `openFollowPane` to reveal a follow panel for the session (a dedicated `FollowWidget` opened in the main area, or a right-side panel — follow the simplest approach consistent with the codebase; a `ReactWidget` registered via `WidgetFactory` keyed by session is acceptable). Ensure `.catch` on the async open.

- [ ] **Step 3: Manual-shaped test note** — focus wiring is integration; verify via typecheck + the Slice-2 manual run (Task 12). Add a unit test only for any pure helper introduced.

- [ ] **Step 4: Typecheck**

Run: `cd packages/theia-extensions && npx tsc --noEmit 2>&1 | grep "error TS" | head`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src
git commit -m "feat(darkfactory): focus mode — resume terminal or read-only follow"
```

---

## Slice 3 — Needs-you routing

### Task 10: Needs-you heuristic (external, best-effort)

**Files:**
- Create: `packages/theia-extensions/src/node/darkfactory/needs-you.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/needs-you.test.ts`
- Modify: `spexr-darkfactory-backend-service.ts` (populate `needsYou` / `needsYouCertain` on tiles)

**Interfaces:**
- Produces: `guessNeedsYou(entries, isLive, mtimeMs, nowMs): boolean` — true when a live session's last transcript entry ended in a permission-requiring tool-use and no newer write followed within a short settle window.

- [ ] **Step 1: Write the failing test**

```ts
import { guessNeedsYou } from "./needs-you.js";

const NOW = 1_000_000;
const permTurn = [{ message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "rm x" } }] } }];

test("live + trailing permission tool-use + settled → maybe waiting", () => {
  expect(guessNeedsYou(permTurn, true, NOW - 4_000, NOW)).toBe(true);
});

test("not live → false", () => {
  expect(guessNeedsYou(permTurn, false, NOW - 4_000, NOW)).toBe(false);
});

test("recent write (still streaming) → false", () => {
  expect(guessNeedsYou(permTurn, true, NOW - 200, NOW)).toBe(false);
});

test("trailing plain text (not a tool) → false", () => {
  expect(guessNeedsYou([{ message: { role: "assistant", content: [{ type: "text", text: "done" }] } }], true, NOW - 4_000, NOW)).toBe(false);
});
```

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `cd packages/theia-extensions && npx vitest run needs-you`

- [ ] **Step 3: Implement**

```ts
/** Tools that can trigger a permission prompt. */
const PERMISSION_TOOLS = new Set(["Bash", "Edit", "Write", "WebFetch"]);
const SETTLE_MS = 2_000;

interface NeedsYouEntry { message?: { role?: string; content?: unknown }; }

/**
 * Best-effort guess that an external live session is waiting for the user:
 * its last entry is a permission-requiring tool-use and no write has landed for
 * `SETTLE_MS` (so it is not mid-stream). Heuristic — the real prompt is in the
 * process TTY, not the transcript.
 */
export function guessNeedsYou(entries: NeedsYouEntry[], isLive: boolean, mtimeMs: number, nowMs: number): boolean {
  if (!isLive || nowMs - mtimeMs < SETTLE_MS) return false;
  const last = entries[entries.length - 1]?.message;
  if (last?.role !== "assistant" || !Array.isArray(last.content)) return false;
  const tail = last.content[last.content.length - 1] as { type?: string; name?: string };
  return tail?.type === "tool_use" && !!tail.name && PERMISSION_TOOLS.has(tail.name);
}
```

- [ ] **Step 4: Run it — Expected: PASS**

Run: `cd packages/theia-extensions && npx vitest run needs-you`

- [ ] **Step 5: Wire into the service** — in `listTiles`, set `needsYou = guessNeedsYou(entries, state === "working", mtimeMs, now)` and `needsYouCertain = false` for external sessions. (Embedded-terminal exact detection is Task 11.) Re-run the service test; adjust the fixture if the working session now flips `needsYou`.

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/needs-you.ts packages/theia-extensions/src/node/darkfactory/needs-you.test.ts packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.test.ts
git commit -m "feat(darkfactory): best-effort needs-you heuristic for external agents"
```

### Task 11: Exact needs-you for embedded terminals + alert motion

**Files:**
- Modify: `packages/theia-extensions/src/browser/darkfactory/darkfactory-terminal-manager.ts` (expose a per-session "awaiting input" signal)
- Modify: `packages/theia-extensions/src/browser/darkfactory/darkfactory-wall-widget.tsx` (merge embedded exact signal over the backend tiles; mark `needsYouCertain`)
- Modify: `packages/theia-extensions/src/browser/style/spexr.css` (alert motion + optional chime hook)

**Interfaces:**
- Produces: `SpexrDarkfactoryTerminalManager.awaitingInput(sessionId): boolean` (derived from the embedded PTY — e.g. the readiness/idle heuristic already used by `ClaudeTerminalManager.armReadiness`, reused to detect a settled prompt), and an `onAwaitingChanged` event the widget merges into tile state as `needsYou = true, needsYouCertain = true`.

- [ ] **Step 1: Implement the embedded signal** — reuse the PTY-idle readiness approach from `ClaudeTerminalManager` (`READY_IDLE_MS`) to mark an embedded session "awaiting input" after output settles following a prompt. Expose `awaitingInput(sessionId)` + an emitter `onAwaitingChanged$`.

- [ ] **Step 2: Merge in the widget** — when rendering tiles, overlay the embedded manager's awaiting set: for sessions with an open embedded terminal, set `needsYou = awaitingInput(sessionId)` and `needsYouCertain = true`, overriding the backend best-effort value. Re-sort (needs-you already floats to top via `sortTiles`).

- [ ] **Step 3: Alert motion** — in `spexr.css`, add the `spexr-df-alert` keyframe (a gentle border/glow pulse) applied to `.spexr-df-tile[data-needs-you="1"]`, and a stronger treatment when `data-needs-you-certain="1"`. Gate all of it behind `@media (prefers-reduced-motion: no-preference)`. Add a data hook (e.g. a class toggle) where a future soft chime can attach; do not add audio in this task.

- [ ] **Step 4: Typecheck + tests + darkfactory suite**

Run: `cd packages/theia-extensions && npx tsc --noEmit 2>&1 | grep "error TS" | head` (expect 0) and `npx vitest run darkfactory`

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src
git commit -m "feat(darkfactory): exact needs-you for embedded terminals with alert motion"
```

### Task 12: Build, wire-check, and manual verification

**Files:** none (integration gate).

- [ ] **Step 1: Full package check**

Run: `cd packages/theia-extensions && npx tsc --noEmit && npx vitest run` — 0 type errors; only the known pre-existing model-asset integration failures remain.

- [ ] **Step 2: Build the extension lib + desktop bundle**

Run (from the worktree root): `pnpm --filter @spexr/theia-extensions build && pnpm --filter @spexr/desktop build`
Expected: `webpack ... compiled successfully`. (If the worktree lacks the electron binary, copy it from the main checkout's `node_modules/electron/dist` as done previously, then rebuild.)

- [ ] **Step 3: Confirm the wall is in the bundle**

Run: `grep -rl "spexr.view.darkfactory" apps/desktop/lib/frontend/bundle.js`
Expected: a match.

- [ ] **Step 4: Manual end-to-end verification** (`pnpm --filter @spexr/desktop start` from the worktree)
- The Darkfactory tab opens by default (reveal-on-restore, from v1).
- With several real Claude sessions running, tiles appear per project; a session actively writing shows **Working**; others **Idle**/**Done**. (Cross-check against `ps -Ao pid,comm | grep claude`.)
- Each tile shows a distilled action line + tool chip; permission-mode shows an icon with a tooltip (no bare "auto"/"normal").
- Clicking an **idle** tile opens an interactive `claude --resume` terminal in the main area, in that project's directory.
- Clicking a **working** (live-elsewhere) tile opens a read-only follow that streams new turns; "Fork & take over" opens a forked terminal.
- A tile that appears to be waiting floats to the top with the alert treatment; reduced-motion disables the animation.

- [ ] **Step 5: Commit any fixes found during manual verification**, then stop for the whole-branch review.

---

## Self-review notes (for the executor)

- **v1 removal:** Task 1 deletes `open-transcripts.ts`; Task 7 replaces the v1 list widget. Ensure no stale imports of the removed symbols remain (`grep -rn "open-transcripts\|OpenTranscript" src`).
- **Follow appended-lines correctness:** `startFollow` should track a per-session byte/line offset so each `onFollowChunk` sends only newly-appended turns, not the whole transcript each time. Implement the offset in Task 6/9; if simplest-correct is to re-read and diff by line count, document it.
- **Browser/node split:** `buildResumeArgs` lives in a node module; the browser terminal manager must re-validate the UUID before spawning (do not import node modules into the browser bundle).
- **accentId stability:** derive from `projectPath` hash so a project keeps its colour across refreshes.
