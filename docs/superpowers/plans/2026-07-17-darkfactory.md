# Darkfactory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a machine-wide, read-only "Darkfactory" tab to SPEXR that lists every Claude Code session (one per transcript), grouped by project, with live/idle status and a one-line AI activity summary.

**Architecture:** A node backend service (`SpexrDarkfactoryBackendService`) scans `~/.claude/projects/*/*.jsonl`, parses each transcript into an `AgentSession`, classifies liveness by cross-referencing `lsof`-reported open transcripts, watches the directory for changes, and generates summaries by reusing the already-loaded Qwen worker. A React `ReactWidget` renders the cards and streams updates over the existing client-callback RPC pattern.

**Tech Stack:** TypeScript, Theia (Inversify DI, `RpcConnectionHandler` / `createProxy`, `ReactWidget`, `AbstractViewContribution`, `WorkspaceService`), Node (`fs`, `child_process` for `lsof`), `@huggingface/transformers` (existing worker), Jest.

## Global Constraints

- `@spexr/agent` and pure modules stay Theia-agnostic; Theia DI lives only in `@spexr/theia-extensions` (`src/node`, `src/browser`). Copied verbatim from spec `0002` Notes.
- Product UI copy is English (nls); summaries are English. Internal design docs may be Italian.
- Model is `onnx-community/Qwen2.5-Coder-1.5B-Instruct` q4, loaded once in the single description worker; **do not** load a second model instance for summaries — extend the existing worker.
- Non-parseable transcript lines are skipped, never fatal (matches the `skip non-parseable files` precedent).
- Graceful degradation: missing `~/.claude/projects` → empty list; `lsof` unavailable/timeout → modified-time fallback (no live state); model unavailable → heuristic summary (truncated last prompt).
- Defaults: idle window = 12h; summary context = last 6 turns.

---

## File Structure

**Backend (node), all under `packages/theia-extensions/src/node/darkfactory/`:**
- `transcript-parser.ts` — pure: `string[]` transcript lines → parsed fields. Testable, no `fs`.
- `liveness.ts` — pure: classify one session as `live` / `idle` / `archived`.
- `open-transcripts.ts` — run `lsof`, return the set of transcript paths open by `claude` processes (or `null` on failure).
- `turns.ts` — pure: build the summary prompt text from transcript entries.
- `spexr-darkfactory-backend-service.ts` — orchestrates scan, watch, liveness poll, summarize, reveal.

**Worker reuse (existing files):**
- `packages/theia-extensions/src/node/search/description-format.ts` — add summary request kind + prompt.
- `packages/theia-extensions/src/node/search/description-worker.ts` — branch on request kind.
- `packages/theia-extensions/src/node/search/worker-description-generator.ts` — add `summarize()`.

**Protocol (common):**
- `packages/theia-extensions/src/common/darkfactory-protocol.ts` — types, service + client interfaces, service path.

**Frontend (browser), all under `packages/theia-extensions/src/browser/darkfactory/`:**
- `darkfactory-service-proxy.ts` — proxy Symbol + re-exports.
- `darkfactory-client.ts` — client dispatcher (`onAgentsChanged` event).
- `darkfactory-format.ts` — pure formatters: relative time, state label/color, group-by-project.
- `darkfactory-widget.tsx` — `ReactWidget` (cards + actions).
- `darkfactory-view-contribution.ts` — `AbstractViewContribution` (tab, command, keybinding).

**Wiring (existing files):**
- `packages/theia-extensions/src/node/spexr-backend-module.ts` — bind service + connection handler.
- `packages/theia-extensions/src/browser/spexr-frontend-module.ts` — bind proxy, client, widget factory, view contribution.

---

## Slice 1 — Transcript parsing (pure)

### Task 1: Transcript parser

**Files:**
- Create: `packages/theia-extensions/src/node/darkfactory/transcript-parser.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/transcript-parser.test.ts`

**Interfaces:**
- Produces: `parseTranscript(lines: string[]): ParsedTranscript` and the `ParsedTranscript` type used by Task 6 (the service).

- [ ] **Step 1: Write the failing test**

```ts
import { parseTranscript } from "./transcript-parser.js";

const lines = [
  `{"type":"mode","mode":"normal"}`,
  `{"type":"permission-mode","permissionMode":"auto"}`,
  `{"cwd":"/Users/x/src/proj","gitBranch":"main","type":"user","message":{"role":"user","content":"refactor auth"}}`,
  `not json — must be skipped`,
  `{"cwd":"/Users/x/src/proj","type":"assistant","message":{"role":"assistant","content":[{"type":"tool_use","name":"Edit"}]}}`,
  `{"cwd":"/Users/x/src/proj","type":"user","message":{"role":"user","content":"now run tests"}}`,
];

test("extracts cwd, branch, modes, turn count, last prompt, last tool", () => {
  const p = parseTranscript(lines);
  expect(p.cwd).toBe("/Users/x/src/proj");
  expect(p.gitBranch).toBe("main");
  expect(p.mode).toBe("normal");
  expect(p.permissionMode).toBe("auto");
  expect(p.userTurns).toBe(2);
  expect(p.lastPrompt).toBe("now run tests");
  expect(p.lastTool).toBe("Edit");
});

test("empty transcript yields safe defaults", () => {
  const p = parseTranscript([]);
  expect(p.cwd).toBeUndefined();
  expect(p.userTurns).toBe(0);
  expect(p.lastPrompt).toBe("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test -- transcript-parser`
Expected: FAIL — "Cannot find module './transcript-parser.js'".

- [ ] **Step 3: Write minimal implementation**

```ts
/** Fields distilled from one Claude Code transcript (`.jsonl`). */
export interface ParsedTranscript {
  cwd?: string;
  gitBranch?: string;
  mode?: string;
  permissionMode?: string;
  userTurns: number;
  lastPrompt: string;
  lastTool?: string;
}

/** Text of a user message whose `content` is a string or an array of blocks. */
function userText(content: unknown): string | undefined {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const t = content.find((b) => b && typeof b === "object" && (b as { type?: string }).type === "text");
    const text = (t as { text?: string } | undefined)?.text;
    if (typeof text === "string") return text;
  }
  return undefined;
}

/** Name of the last `tool_use` block in an assistant message, if any. */
function toolName(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (let i = content.length - 1; i >= 0; i--) {
    const b = content[i] as { type?: string; name?: string } | undefined;
    if (b?.type === "tool_use" && typeof b.name === "string") return b.name;
  }
  return undefined;
}

/**
 * Parse transcript lines into display fields. Lines that are not valid JSON, or
 * do not match a known shape, are skipped — never throw.
 */
export function parseTranscript(lines: string[]): ParsedTranscript {
  const out: ParsedTranscript = { userTurns: 0, lastPrompt: "" };
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof e.cwd === "string") out.cwd = e.cwd;
    if (typeof e.gitBranch === "string") out.gitBranch = e.gitBranch;
    if (e.type === "mode" && typeof e.mode === "string") out.mode = e.mode;
    if (e.type === "permission-mode" && typeof e.permissionMode === "string") {
      out.permissionMode = e.permissionMode;
    }
    const msg = e.message as { role?: string; content?: unknown } | undefined;
    if (msg?.role === "user") {
      const text = userText(msg.content);
      if (typeof text === "string") {
        out.userTurns++;
        out.lastPrompt = text.replace(/\s+/g, " ").trim().slice(0, 200);
      }
    } else if (msg?.role === "assistant") {
      const tool = toolName(msg.content);
      if (tool) out.lastTool = tool;
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test -- transcript-parser`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/transcript-parser.ts packages/theia-extensions/src/node/darkfactory/transcript-parser.test.ts
git commit -m "feat(darkfactory): parse Claude transcript into display fields"
```

---

## Slice 2 — Liveness (pure + lsof)

### Task 2: Liveness classifier

**Files:**
- Create: `packages/theia-extensions/src/node/darkfactory/liveness.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/liveness.test.ts`

**Interfaces:**
- Consumes: `AgentState` from Task 5 (`common/darkfactory-protocol.ts`). Until Task 5 lands, this file defines the string union inline and Task 5 imports it back — to avoid that, **do Task 5 before Task 2** if executing out of order. As written here, `liveness.ts` imports `AgentState` from the protocol.
- Produces: `classifyState(transcriptPath, mtimeMs, openPaths, nowMs, idleWindowMs): AgentState`.

- [ ] **Step 1: Write the failing test**

```ts
import { classifyState } from "./liveness.js";

const HOUR = 3_600_000;

test("open transcript is live regardless of mtime", () => {
  const open = new Set(["/p/a.jsonl"]);
  expect(classifyState("/p/a.jsonl", 0, open, 100 * HOUR, 12 * HOUR)).toBe("live");
});

test("recently modified but not open is idle", () => {
  expect(classifyState("/p/a.jsonl", 95 * HOUR, new Set(), 100 * HOUR, 12 * HOUR)).toBe("idle");
});

test("old and not open is archived", () => {
  expect(classifyState("/p/a.jsonl", 10 * HOUR, new Set(), 100 * HOUR, 12 * HOUR)).toBe("archived");
});

test("null openPaths (lsof unavailable) never yields live", () => {
  expect(classifyState("/p/a.jsonl", 95 * HOUR, null, 100 * HOUR, 12 * HOUR)).toBe("idle");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test -- liveness`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { AgentState } from "../../common/darkfactory-protocol.js";

/**
 * Classify a session. `openPaths` is the set of transcript paths currently held
 * open by a `claude` process, or `null` when liveness could not be determined
 * (e.g. `lsof` unavailable) — in which case a session is never reported live.
 */
export function classifyState(
  transcriptPath: string,
  mtimeMs: number,
  openPaths: Set<string> | null,
  nowMs: number,
  idleWindowMs: number,
): AgentState {
  if (openPaths?.has(transcriptPath)) return "live";
  if (nowMs - mtimeMs <= idleWindowMs) return "idle";
  return "archived";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test -- liveness`
Expected: PASS (4 tests). (Requires Task 5's protocol file; if running strictly in order, land Task 5 first — see the Interfaces note.)

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/liveness.ts packages/theia-extensions/src/node/darkfactory/liveness.test.ts
git commit -m "feat(darkfactory): classify session live/idle/archived"
```

### Task 3: Open-transcript detection via lsof

**Files:**
- Create: `packages/theia-extensions/src/node/darkfactory/open-transcripts.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/open-transcripts.test.ts`

**Interfaces:**
- Produces: `parseLsofOutput(stdout: string, projectsDir: string): Set<string>` (pure, tested) and `openTranscriptPaths(projectsDir, deps?): Promise<Set<string> | null>` (runs `lsof`; injected runner for tests).

- [ ] **Step 1: Write the failing test**

```ts
import { parseLsofOutput, openTranscriptPaths } from "./open-transcripts.js";

const DIR = "/Users/x/.claude/projects";

test("parseLsofOutput keeps only .jsonl paths under projectsDir", () => {
  const stdout = [
    `${DIR}/-proj/a.jsonl`,
    `/tmp/other.log`,
    `${DIR}/-proj/b.txt`,
    `${DIR}/-p2/c.jsonl`,
  ].join("\n");
  const set = parseLsofOutput(stdout, DIR);
  expect([...set].sort()).toEqual([`${DIR}/-p2/c.jsonl`, `${DIR}/-proj/a.jsonl`]);
});

test("openTranscriptPaths returns null when the runner throws", async () => {
  const set = await openTranscriptPaths(DIR, {
    run: () => Promise.reject(new Error("lsof: command not found")),
  });
  expect(set).toBeNull();
});

test("openTranscriptPaths returns parsed set from runner stdout", async () => {
  const set = await openTranscriptPaths(DIR, {
    run: () => Promise.resolve(`${DIR}/-proj/a.jsonl\n`),
  });
  expect(set).toEqual(new Set([`${DIR}/-proj/a.jsonl`]));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @spexr/theia-extensions test -- open-transcripts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { execFile } from "node:child_process";

/** Injectable command runner so tests never spawn a real process. */
export interface LsofDeps {
  run: () => Promise<string>;
}

/** Keep only lines that are `.jsonl` files under `projectsDir`. */
export function parseLsofOutput(stdout: string, projectsDir: string): Set<string> {
  const set = new Set<string>();
  for (const raw of stdout.split("\n")) {
    const path = raw.trim();
    if (path.endsWith(".jsonl") && path.startsWith(projectsDir)) set.add(path);
  }
  return set;
}

function defaultRun(projectsDir: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    // -c claude: files opened by processes named "claude"; -Fn: output file names, one per line.
    execFile("lsof", ["-c", "claude", "-Fn"], { timeout: timeoutMs, maxBuffer: 8 << 20 }, (err, stdout) => {
      // lsof exits non-zero when *some* pids are inaccessible even though stdout is valid;
      // only reject when there is no usable output at all.
      if (err && !stdout) reject(err);
      else resolve(stripFnPrefix(stdout));
    });
  });
}

/** `-Fn` lines are prefixed with `n`; drop that and non-`n` records. */
function stripFnPrefix(stdout: string): string {
  return stdout
    .split("\n")
    .filter((l) => l.startsWith("n"))
    .map((l) => l.slice(1))
    .join("\n");
}

/**
 * Transcript paths currently open by a `claude` process, or `null` when
 * detection failed (caller then falls back to modified-time-only classification).
 */
export async function openTranscriptPaths(
  projectsDir: string,
  deps?: LsofDeps,
  timeoutMs = 1500,
): Promise<Set<string> | null> {
  try {
    const stdout = deps ? await deps.run() : await defaultRun(projectsDir, timeoutMs);
    return parseLsofOutput(stdout, projectsDir);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @spexr/theia-extensions test -- open-transcripts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/open-transcripts.ts packages/theia-extensions/src/node/darkfactory/open-transcripts.test.ts
git commit -m "feat(darkfactory): detect claude-held transcripts via lsof"
```

---

## Slice 3 — Summary generation (worker reuse)

### Task 4: Extend the worker for summaries

**Files:**
- Modify: `packages/theia-extensions/src/node/search/description-format.ts`
- Modify: `packages/theia-extensions/src/node/search/description-worker.ts`
- Modify: `packages/theia-extensions/src/node/search/worker-description-generator.ts`
- Create: `packages/theia-extensions/src/node/darkfactory/turns.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/turns.test.ts`
- Test: `packages/theia-extensions/src/node/search/worker-description-generator.test.ts` (extend if present, else create)

**Interfaces:**
- Consumes: existing `WorkerDescriptionGenerator`, `WorkerRequest`, `WorkerResponse`.
- Produces: `buildTurnsText(entries, maxTurns): string`; `WorkerDescriptionGenerator.summarize(turnsText: string): Promise<string | null>`.

- [ ] **Step 1: Write the failing test for `buildTurnsText`**

```ts
import { buildTurnsText } from "./turns.js";

test("keeps the last N user/assistant turns as role: text lines", () => {
  const entries = [
    { message: { role: "user", content: "first" } },
    { message: { role: "assistant", content: [{ type: "text", text: "ok" }] } },
    { message: { role: "user", content: "second" } },
    { message: { role: "assistant", content: [{ type: "tool_use", name: "Edit" }] } },
    { message: { role: "user", content: "third" } },
  ];
  const text = buildTurnsText(entries, 2);
  expect(text).toBe("assistant: [tool_use: Edit]\nuser: third");
});
```

- [ ] **Step 2: Run it — Expected: FAIL (module not found)**

Run: `pnpm --filter @spexr/theia-extensions test -- turns`

- [ ] **Step 3: Implement `turns.ts`**

```ts
/** One transcript entry, loosely typed (only `message` is read). */
export interface TurnEntry {
  message?: { role?: string; content?: unknown };
}

function renderContent(content: unknown): string {
  if (typeof content === "string") return content.replace(/\s+/g, " ").trim();
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        const block = b as { type?: string; text?: string; name?: string };
        if (block.type === "text") return (block.text ?? "").replace(/\s+/g, " ").trim();
        if (block.type === "tool_use") return `[tool_use: ${block.name ?? "?"}]`;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/**
 * Render the last `maxTurns` user/assistant turns as `role: text` lines, for the
 * summary prompt. Tool calls become `[tool_use: Name]` so the model can describe
 * what the agent is doing even when there is no prose.
 */
export function buildTurnsText(entries: TurnEntry[], maxTurns: number): string {
  const turns = entries
    .filter((e) => e.message?.role === "user" || e.message?.role === "assistant")
    .slice(-maxTurns)
    .map((e) => `${e.message!.role}: ${renderContent(e.message!.content)}`.trim())
    .filter((l) => !l.endsWith(":"));
  return turns.join("\n");
}
```

- [ ] **Step 4: Run it — Expected: PASS**

Run: `pnpm --filter @spexr/theia-extensions test -- turns`

- [ ] **Step 5: Add the summary request kind + prompt to `description-format.ts`**

Add near the existing prompt constants:

```ts
export const SUMMARY_MAX_NEW_TOKENS = 32;

export const SUMMARY_SYSTEM_PROMPT =
  "You are given the last few turns of a coding-assistant session. Reply with a single present-tense " +
  "clause describing what the assistant is currently doing, max 12 words, no preamble, no markdown, " +
  "no trailing period. Example: 'refactoring the auth middleware to fix token expiry'.";

/** User message for a session summary. */
export function buildSummaryPrompt(turnsText: string): string {
  return `Session turns:\n${turnsText}\n\nWhat is the assistant currently doing?`;
}
```

Change `WorkerRequest` to carry a kind (default `"description"` keeps existing callers valid):

```ts
/** host → worker */
export interface WorkerRequest {
  id: number;
  kind?: "description" | "summary";
  relPath: string;
  content: string;
}
```

- [ ] **Step 6: Branch on kind in `description-worker.ts`**

Import the new symbols and replace the body of `handle` so summaries use the summary prompt/token budget while sharing the one loaded pipe:

```ts
import {
  GEN_MODEL_ID, MAX_NEW_TOKENS, DESCRIPTION_SYSTEM_PROMPT,
  SUMMARY_MAX_NEW_TOKENS, SUMMARY_SYSTEM_PROMPT, buildSummaryPrompt,
  buildPrompt, cleanGenerated, type WorkerRequest, type WorkerResponse,
} from "./description-format.js";

async function handle(req: WorkerRequest): Promise<void> {
  const { id, kind, relPath, content } = req;
  try {
    const pipe = await getPipe();
    const system = kind === "summary" ? SUMMARY_SYSTEM_PROMPT : DESCRIPTION_SYSTEM_PROMPT;
    const user = kind === "summary" ? buildSummaryPrompt(content) : buildPrompt(relPath, content);
    const maxTokens = kind === "summary" ? SUMMARY_MAX_NEW_TOKENS : MAX_NEW_TOKENS;
    const out = await pipe(
      [{ role: "system", content: system }, { role: "user", content: user }],
      { max_new_tokens: maxTokens, do_sample: false },
    );
    const msgs = out[0]?.generated_text;
    const last = Array.isArray(msgs) ? msgs[msgs.length - 1] : undefined;
    const raw = typeof last?.content === "string" ? last.content : "";
    const text = cleanGenerated(raw);
    post({ id, type: "done", text: text.length > 0 ? text : null });
  } catch {
    post({ id, type: "error" });
  }
}
```

- [ ] **Step 7: Add `summarize()` to `worker-description-generator.ts`**

Extend the `DescriptionGenerator` interface in `description-format.ts`:

```ts
export interface DescriptionGenerator {
  generate(relPath: string, content: string): Promise<string | null>;
  summarize(turnsText: string): Promise<string | null>;
  isAvailable(): boolean;
  dispose?(): void;
}
```

Add the method to `WorkerDescriptionGenerator` (mirrors `generate`, sets `kind: "summary"`, `relPath: ""`):

```ts
summarize(turnsText: string): Promise<string | null> {
  const worker = this.ensureWorker();
  if (!worker) return Promise.resolve(null);
  const id = ++this.seq;
  return new Promise<string | null>((resolve) => {
    this.pending.set(id, { resolve });
    worker.postMessage({ id, kind: "summary", relPath: "", content: turnsText });
  });
}
```

- [ ] **Step 8: Add a generator test for summarize (fake worker)**

```ts
import { WorkerDescriptionGenerator } from "./worker-description-generator.js";
import type { WorkerLike } from "./worker-description-generator.js";

test("summarize posts a summary request and resolves with worker text", async () => {
  let posted: unknown;
  const fake: WorkerLike = {
    postMessage: (m) => { posted = m; setTimeout(() => cb!({ id: (m as { id: number }).id, type: "done", text: "fixing auth" }), 0); },
    on: (ev, fn) => { if (ev === "message") cb = fn as typeof cb; },
    terminate: () => undefined,
  };
  let cb: ((m: { id: number; type: string; text: string | null }) => void) | undefined;
  const gen = new WorkerDescriptionGenerator(() => fake);
  const text = await gen.summarize("user: fix auth");
  expect((posted as { kind: string }).kind).toBe("summary");
  expect(text).toBe("fixing auth");
});
```

(If `WorkerLike` is not exported, export it from `worker-description-generator.ts`.)

- [ ] **Step 9: Run the worker tests + typecheck**

Run: `pnpm --filter @spexr/theia-extensions test -- worker-description-generator turns` and `pnpm --filter @spexr/theia-extensions typecheck`
Expected: PASS; no type errors (existing `generate`-only callers still compile because `kind` is optional and defaults to description).

- [ ] **Step 10: Commit**

```bash
git add packages/theia-extensions/src/node/search/description-format.ts packages/theia-extensions/src/node/search/description-worker.ts packages/theia-extensions/src/node/search/worker-description-generator.ts packages/theia-extensions/src/node/darkfactory/turns.ts packages/theia-extensions/src/node/darkfactory/turns.test.ts packages/theia-extensions/src/node/search/worker-description-generator.test.ts
git commit -m "feat(darkfactory): reuse the Qwen worker for one-line session summaries"
```

---

## Slice 4 — Protocol + backend service

### Task 5: Protocol

**Files:**
- Create: `packages/theia-extensions/src/common/darkfactory-protocol.ts`

**Interfaces:**
- Produces: `AgentState`, `AgentSession`, `AgentSummary`, `SpexrDarkfactoryService`, `SpexrDarkfactoryClient`, `DARKFACTORY_SERVICE_PATH` — consumed by Tasks 2, 6, 7, 8, 9, 10.

- [ ] **Step 1: Write the protocol (no test — pure declarations)**

```ts
export const DARKFACTORY_SERVICE_PATH = "/services/spexr-darkfactory";

export type AgentState = "live" | "idle" | "archived";

/** One Claude Code session (one transcript), as shown on a Darkfactory card. */
export interface AgentSession {
  /** Transcript filename stem; stable id for summaries. */
  sessionId: string;
  /** Absolute path to the `.jsonl` transcript. */
  transcriptPath: string;
  /** Real project directory (from the transcript `cwd`). */
  projectPath: string;
  /** Basename of `projectPath`, for the card title. */
  projectName: string;
  gitBranch?: string;
  state: AgentState;
  /** Transcript modified time, epoch ms. */
  lastActivityMs: number;
  /** Number of user turns. */
  turnCount: number;
  /** Truncated last user prompt; also the heuristic summary fallback. */
  lastPrompt: string;
  lastTool?: string;
  mode?: string;
  permissionMode?: string;
}

/** A generated one-line activity summary for a session. */
export interface AgentSummary {
  sessionId: string;
  text: string;
  /** False when the model was unavailable and `text` is the heuristic fallback. */
  fromModel: boolean;
}

/** Backend service consumed by the Darkfactory widget. */
export interface SpexrDarkfactoryService {
  /** All sessions (live + idle by default; `includeArchived` adds older ones). */
  listAgents(includeArchived?: boolean): Promise<AgentSession[]>;
  /** One-line summary for a session (model, else heuristic). */
  summarize(sessionId: string): Promise<AgentSummary>;
  /** Reveal a project directory in the OS file manager. */
  revealInFileManager(projectPath: string): Promise<void>;
}

/** Push channel: backend → frontend when the session set changes. */
export interface SpexrDarkfactoryClient {
  onAgentsChanged(agents: AgentSession[]): void;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: PASS (also unblocks Task 2's import).

- [ ] **Step 3: Commit**

```bash
git add packages/theia-extensions/src/common/darkfactory-protocol.ts
git commit -m "feat(darkfactory): add service/client protocol"
```

### Task 6: Backend service

**Files:**
- Create: `packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts`
- Test: `packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.test.ts`
- Modify: `packages/theia-extensions/src/node/spexr-backend-module.ts`

**Interfaces:**
- Consumes: `parseTranscript` (Task 1), `classifyState` (Task 2), `openTranscriptPaths` (Task 3), `buildTurnsText` (Task 4), `DescriptionGeneratorToken`/`DescriptionGenerator` (existing), protocol types (Task 5).
- Produces: `SpexrDarkfactoryBackendService implements SpexrDarkfactoryService`, with `setClient(client)` and injectable filesystem/dir seams for testing (`ProjectsDirToken`, defaulting to `~/.claude/projects`).

- [ ] **Step 1: Write the failing test (scan + summary fallback, with a fake fs layer)**

```ts
import { SpexrDarkfactoryBackendService } from "./spexr-darkfactory-backend-service.js";

const IDLE_WINDOW = 12 * 3_600_000;

function svc(over: Partial<ConstructorParameters<typeof SpexrDarkfactoryBackendService>[0]>) {
  return new SpexrDarkfactoryBackendService({
    projectsDir: "/PD",
    now: () => 100 * 3_600_000,
    idleWindowMs: IDLE_WINDOW,
    listTranscripts: () => Promise.resolve([
      { sessionId: "s1", transcriptPath: "/PD/-proj/s1.jsonl", mtimeMs: 99 * 3_600_000,
        readLines: () => Promise.resolve([`{"cwd":"/Users/x/src/proj","gitBranch":"main","type":"user","message":{"role":"user","content":"do X"}}`]) },
    ]),
    openTranscriptPaths: () => Promise.resolve(new Set<string>()),
    generator: { generate: async () => null, summarize: async () => null, isAvailable: () => false },
    ...over,
  });
}

test("listAgents maps a transcript to an idle AgentSession", async () => {
  const agents = await svc({}).listAgents();
  expect(agents).toHaveLength(1);
  expect(agents[0]).toMatchObject({
    sessionId: "s1", projectPath: "/Users/x/src/proj", projectName: "proj",
    gitBranch: "main", state: "idle", lastPrompt: "do X", turnCount: 1,
  });
});

test("summarize falls back to heuristic when the model is unavailable", async () => {
  const s = svc({});
  await s.listAgents();
  const summary = await s.summarize("s1");
  expect(summary).toEqual({ sessionId: "s1", text: "do X", fromModel: false });
});

test("model summary is used and cached per mtime", async () => {
  let calls = 0;
  const s = svc({ generator: { generate: async () => null, isAvailable: () => true, summarize: async () => { calls++; return "doing X"; } } });
  await s.listAgents();
  expect(await s.summarize("s1")).toEqual({ sessionId: "s1", text: "doing X", fromModel: true });
  await s.summarize("s1");
  expect(calls).toBe(1); // cached
});
```

- [ ] **Step 2: Run it — Expected: FAIL (module not found)**

Run: `pnpm --filter @spexr/theia-extensions test -- spexr-darkfactory-backend-service`

- [ ] **Step 3: Implement the service**

```ts
import { injectable, inject, optional } from "@theia/core/shared/inversify";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import { watch, type FSWatcher } from "node:fs";
import { DescriptionGeneratorToken, type DescriptionGenerator } from "../search/description-format.js";
import { parseTranscript } from "./transcript-parser.js";
import { classifyState } from "./liveness.js";
import { openTranscriptPaths as defaultOpenTranscriptPaths } from "./open-transcripts.js";
import { buildTurnsText, type TurnEntry } from "./turns.js";
import type {
  AgentSession, AgentSummary, SpexrDarkfactoryService, SpexrDarkfactoryClient,
} from "../../common/darkfactory-protocol.js";

const IDLE_WINDOW_MS = 12 * 3_600_000;
const SUMMARY_TURNS = 6;

/** One transcript file discovered on disk; `readLines` is lazy. */
export interface TranscriptRef {
  sessionId: string;
  transcriptPath: string;
  mtimeMs: number;
  readLines(): Promise<string[]>;
}

/** Constructor seams so the service is unit-testable without a real home dir. */
export interface DarkfactoryDeps {
  projectsDir?: string;
  now?: () => number;
  idleWindowMs?: number;
  listTranscripts?: () => Promise<TranscriptRef[]>;
  openTranscriptPaths?: (projectsDir: string) => Promise<Set<string> | null>;
  generator?: DescriptionGenerator;
}

@injectable()
export class SpexrDarkfactoryBackendService implements SpexrDarkfactoryService {
  private readonly projectsDir: string;
  private readonly now: () => number;
  private readonly idleWindowMs: number;
  private readonly listTranscripts: () => Promise<TranscriptRef[]>;
  private readonly openPaths: (projectsDir: string) => Promise<Set<string> | null>;
  private readonly generator: DescriptionGenerator;

  private client?: SpexrDarkfactoryClient;
  private watcher?: FSWatcher;
  /** sessionId → { transcriptPath, mtimeMs, lastPrompt } from the last scan. */
  private readonly index = new Map<string, { transcriptPath: string; mtimeMs: number; lastPrompt: string }>();
  /** sessionId → { mtimeMs, summary } cache. */
  private readonly summaryCache = new Map<string, { mtimeMs: number; summary: AgentSummary }>();

  // @inject via DI in production; the object form is used by tests.
  constructor(
    @inject(DescriptionGeneratorToken) @optional() deps?: DescriptionGenerator | DarkfactoryDeps,
  ) {
    const d: DarkfactoryDeps = isGenerator(deps) ? { generator: deps } : (deps ?? {});
    this.projectsDir = d.projectsDir ?? join(homedir(), ".claude", "projects");
    this.now = d.now ?? Date.now;
    this.idleWindowMs = d.idleWindowMs ?? IDLE_WINDOW_MS;
    this.generator = d.generator ?? nullGenerator();
    this.openPaths = d.openTranscriptPaths ?? ((dir) => defaultOpenTranscriptPaths(dir));
    this.listTranscripts = d.listTranscripts ?? (() => this.scanDisk());
  }

  setClient(client: SpexrDarkfactoryClient): void {
    this.client = client;
    this.ensureWatching();
  }

  async listAgents(includeArchived = false): Promise<AgentSession[]> {
    const [refs, open] = await Promise.all([
      this.listTranscripts(),
      this.openPaths(this.projectsDir),
    ]);
    const now = this.now();
    const agents: AgentSession[] = [];
    this.index.clear();
    for (const ref of refs) {
      const parsed = parseTranscript(await ref.readLines());
      if (!parsed.cwd) continue; // no real project path → skip
      const state = classifyState(ref.transcriptPath, ref.mtimeMs, open, now, this.idleWindowMs);
      if (state === "archived" && !includeArchived) {
        this.index.set(ref.sessionId, { transcriptPath: ref.transcriptPath, mtimeMs: ref.mtimeMs, lastPrompt: parsed.lastPrompt });
        continue;
      }
      this.index.set(ref.sessionId, { transcriptPath: ref.transcriptPath, mtimeMs: ref.mtimeMs, lastPrompt: parsed.lastPrompt });
      agents.push({
        sessionId: ref.sessionId, transcriptPath: ref.transcriptPath,
        projectPath: parsed.cwd, projectName: basename(parsed.cwd),
        gitBranch: parsed.gitBranch, state, lastActivityMs: ref.mtimeMs,
        turnCount: parsed.userTurns, lastPrompt: parsed.lastPrompt,
        lastTool: parsed.lastTool, mode: parsed.mode, permissionMode: parsed.permissionMode,
      });
    }
    return sortAgents(agents);
  }

  async summarize(sessionId: string): Promise<AgentSummary> {
    const meta = this.index.get(sessionId);
    if (!meta) return { sessionId, text: "", fromModel: false };
    const cached = this.summaryCache.get(sessionId);
    if (cached && cached.mtimeMs === meta.mtimeMs) return cached.summary;

    let summary: AgentSummary = { sessionId, text: meta.lastPrompt, fromModel: false };
    if (this.generator.isAvailable()) {
      const lines = await readFileLines(meta.transcriptPath);
      const entries = lines.map(parseLine).filter((e): e is TurnEntry => !!e);
      const text = await this.generator.summarize(buildTurnsText(entries, SUMMARY_TURNS));
      if (text) summary = { sessionId, text, fromModel: true };
    }
    this.summaryCache.set(sessionId, { mtimeMs: meta.mtimeMs, summary });
    return summary;
  }

  async revealInFileManager(projectPath: string): Promise<void> {
    const { execFile } = await import("node:child_process");
    const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
    await new Promise<void>((resolve) => execFile(cmd, [projectPath], () => resolve()));
  }

  private ensureWatching(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.projectsDir, { recursive: true }, debounce(async () => {
        this.client?.onAgentsChanged(await this.listAgents());
      }, 400));
    } catch { /* directory missing → nothing to watch */ }
  }

  private async scanDisk(): Promise<TranscriptRef[]> {
    let projectDirs: string[];
    try {
      projectDirs = await readdir(this.projectsDir);
    } catch {
      return []; // ~/.claude/projects missing
    }
    const refs: TranscriptRef[] = [];
    for (const dir of projectDirs) {
      const full = join(this.projectsDir, dir);
      let files: string[];
      try { files = await readdir(full); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".jsonl")) continue;
        const transcriptPath = join(full, f);
        let mtimeMs: number;
        try { mtimeMs = (await stat(transcriptPath)).mtimeMs; } catch { continue; }
        refs.push({
          sessionId: f.replace(/\.jsonl$/, ""), transcriptPath, mtimeMs,
          readLines: () => readFileLines(transcriptPath),
        });
      }
    }
    return refs;
  }

  dispose(): void {
    this.watcher?.close();
  }
}

function isGenerator(x: unknown): x is DescriptionGenerator {
  return !!x && typeof (x as DescriptionGenerator).summarize === "function" && typeof (x as DescriptionGenerator).isAvailable === "function";
}

function nullGenerator(): DescriptionGenerator {
  return { generate: () => Promise.resolve(null), summarize: () => Promise.resolve(null), isAvailable: () => false };
}

function parseLine(line: string): TurnEntry | undefined {
  try { return JSON.parse(line) as TurnEntry; } catch { return undefined; }
}

async function readFileLines(path: string): Promise<string[]> {
  try { return (await readFile(path, "utf8")).split("\n"); } catch { return []; }
}

/** Live first, then most-recently-active first. */
export function sortAgents(agents: AgentSession[]): AgentSession[] {
  const rank = { live: 0, idle: 1, archived: 2 } as const;
  return [...agents].sort((a, b) => rank[a.state] - rank[b.state] || b.lastActivityMs - a.lastActivityMs);
}

function debounce<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout> | undefined;
  return ((...a: Parameters<T>) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...a), ms); }) as T;
}
```

> Note for the implementer: the constructor deliberately accepts **either** the injected `DescriptionGenerator` (production DI, via `DescriptionGeneratorToken`) **or** a `DarkfactoryDeps` object (tests). Keep the `readLines` in the test double returning the same lines you assert on.

- [ ] **Step 4: Run it — Expected: PASS (3 tests)**

Run: `pnpm --filter @spexr/theia-extensions test -- spexr-darkfactory-backend-service`

- [ ] **Step 5: Bind the service in `spexr-backend-module.ts`**

Add imports and, inside the `ContainerModule`, the binding (mirrors the search service, which also calls `setClient`):

```ts
import { DARKFACTORY_SERVICE_PATH, type SpexrDarkfactoryClient } from "../common/darkfactory-protocol.js";
import { SpexrDarkfactoryBackendService } from "./darkfactory/spexr-darkfactory-backend-service.js";

// …inside ContainerModule:
bind(SpexrDarkfactoryBackendService).toSelf().inSingletonScope();
bind(ConnectionHandler)
  .toDynamicValue((ctx) => {
    const service = ctx.container.get(SpexrDarkfactoryBackendService);
    return new RpcConnectionHandler<SpexrDarkfactoryClient>(DARKFACTORY_SERVICE_PATH, (client) => {
      service.setClient(client);
      return service;
    });
  })
  .inSingletonScope();
```

- [ ] **Step 6: Typecheck + full test run**

Run: `pnpm --filter @spexr/theia-extensions typecheck && pnpm --filter @spexr/theia-extensions test`
Expected: PASS; existing 76 tests still green.

- [ ] **Step 7: Commit**

```bash
git add packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.ts packages/theia-extensions/src/node/darkfactory/spexr-darkfactory-backend-service.test.ts packages/theia-extensions/src/node/spexr-backend-module.ts
git commit -m "feat(darkfactory): backend service — scan, liveness, summaries, reveal"
```

---

## Slice 5 — Frontend

### Task 7: Formatters (pure)

**Files:**
- Create: `packages/theia-extensions/src/browser/darkfactory/darkfactory-format.ts`
- Test: `packages/theia-extensions/src/browser/darkfactory/darkfactory-format.test.ts`

**Interfaces:**
- Produces: `relativeTime(ms, now)`, `stateLabel(state)`, `stateColor(state)`, `groupByProject(agents)` — consumed by Task 9 (widget).

- [ ] **Step 1: Write the failing test**

```ts
import { relativeTime, stateLabel, groupByProject } from "./darkfactory-format.js";
import type { AgentSession } from "../../common/darkfactory-protocol.js";

test("relativeTime renders coarse buckets", () => {
  const now = 1_000_000_000_000;
  expect(relativeTime(now - 30_000, now)).toBe("just now");
  expect(relativeTime(now - 5 * 60_000, now)).toBe("5m ago");
  expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3h ago");
  expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2d ago");
});

test("stateLabel maps enum to copy", () => {
  expect(stateLabel("live")).toBe("Live");
  expect(stateLabel("idle")).toBe("Idle");
});

test("groupByProject clusters by projectPath, preserving order", () => {
  const mk = (id: string, path: string): AgentSession => ({
    sessionId: id, transcriptPath: `/t/${id}.jsonl`, projectPath: path, projectName: path.split("/").pop()!,
    state: "idle", lastActivityMs: 0, turnCount: 0, lastPrompt: "",
  });
  const groups = groupByProject([mk("a", "/x/p1"), mk("b", "/x/p2"), mk("c", "/x/p1")]);
  expect(groups.map((g) => g.projectPath)).toEqual(["/x/p1", "/x/p2"]);
  expect(groups[0].sessions.map((s) => s.sessionId)).toEqual(["a", "c"]);
});
```

- [ ] **Step 2: Run it — Expected: FAIL**

Run: `pnpm --filter @spexr/theia-extensions test -- darkfactory-format`

- [ ] **Step 3: Implement**

```ts
import type { AgentSession, AgentState } from "../../common/darkfactory-protocol.js";

export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function stateLabel(state: AgentState): string {
  return state === "live" ? "Live" : state === "idle" ? "Idle" : "Archived";
}

export function stateColor(state: AgentState): string {
  return state === "live" ? "var(--spexr-df-live)" : state === "idle" ? "var(--spexr-df-idle)" : "var(--spexr-df-archived)";
}

export interface ProjectGroup {
  projectPath: string;
  projectName: string;
  sessions: AgentSession[];
}

export function groupByProject(agents: AgentSession[]): ProjectGroup[] {
  const groups: ProjectGroup[] = [];
  const byPath = new Map<string, ProjectGroup>();
  for (const a of agents) {
    let g = byPath.get(a.projectPath);
    if (!g) {
      g = { projectPath: a.projectPath, projectName: a.projectName, sessions: [] };
      byPath.set(a.projectPath, g);
      groups.push(g);
    }
    g.sessions.push(a);
  }
  return groups;
}
```

- [ ] **Step 4: Run it — Expected: PASS**

Run: `pnpm --filter @spexr/theia-extensions test -- darkfactory-format`

- [ ] **Step 5: Commit**

```bash
git add packages/theia-extensions/src/browser/darkfactory/darkfactory-format.ts packages/theia-extensions/src/browser/darkfactory/darkfactory-format.test.ts
git commit -m "feat(darkfactory): frontend formatters (time, state, grouping)"
```

### Task 8: Service proxy + client dispatcher

**Files:**
- Create: `packages/theia-extensions/src/browser/darkfactory/darkfactory-service-proxy.ts`
- Create: `packages/theia-extensions/src/browser/darkfactory/darkfactory-client.ts`

**Interfaces:**
- Produces: `SpexrDarkfactoryServiceProxy` (Symbol), `SpexrDarkfactoryClientDispatcher` + `SpexrDarkfactoryClientToken`, with `onAgentsChanged$: Event<AgentSession[]>`.

- [ ] **Step 1: Write the proxy Symbol module (mirrors `agent-service-proxy.ts`)**

```ts
import { WebSocketConnectionProvider } from "@theia/core/lib/browser/messaging/ws-connection-provider";
import { DARKFACTORY_SERVICE_PATH, type SpexrDarkfactoryService } from "../../common/darkfactory-protocol.js";

export const SpexrDarkfactoryServiceProxy = Symbol("SpexrDarkfactoryServiceProxy");
export { DARKFACTORY_SERVICE_PATH, WebSocketConnectionProvider };
export type { SpexrDarkfactoryService };
```

- [ ] **Step 2: Write the client dispatcher (mirrors `smart-search-client.ts`)**

```ts
import { injectable } from "@theia/core/shared/inversify";
import { Emitter, type Event } from "@theia/core/lib/common/event";
import type { SpexrDarkfactoryClient, AgentSession } from "../../common/darkfactory-protocol.js";

export const SpexrDarkfactoryClientToken = Symbol("SpexrDarkfactoryClientDispatcher");

@injectable()
export class SpexrDarkfactoryClientDispatcher implements SpexrDarkfactoryClient {
  private readonly emitter = new Emitter<AgentSession[]>();
  readonly onAgentsChanged$: Event<AgentSession[]> = this.emitter.event;

  onAgentsChanged(agents: AgentSession[]): void {
    this.emitter.fire(agents);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/theia-extensions/src/browser/darkfactory/darkfactory-service-proxy.ts packages/theia-extensions/src/browser/darkfactory/darkfactory-client.ts
git commit -m "feat(darkfactory): frontend RPC proxy + client dispatcher"
```

### Task 9: Widget

**Files:**
- Create: `packages/theia-extensions/src/browser/darkfactory/darkfactory-widget.tsx`

**Interfaces:**
- Consumes: `SpexrDarkfactoryServiceProxy`, `SpexrDarkfactoryClientDispatcher`, formatters (Task 7), `WorkspaceService`, `ClipboardService`.
- Produces: `SpexrDarkfactoryWidget` with static `ID = "spexr.view.darkfactory"`.

- [ ] **Step 1: Implement the widget**

```tsx
import * as React from "@theia/core/shared/react";
import { inject, injectable, postConstruct } from "@theia/core/shared/inversify";
import { ReactWidget } from "@theia/core/lib/browser/widgets/react-widget";
import { ClipboardService } from "@theia/core/lib/browser/clipboard-service";
import { WorkspaceService } from "@theia/workspace/lib/browser";
import URI from "@theia/core/lib/common/uri";
import type { AgentSession, SpexrDarkfactoryService } from "../../common/darkfactory-protocol.js";
import { SpexrDarkfactoryServiceProxy } from "./darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher } from "./darkfactory-client.js";
import { relativeTime, stateLabel, stateColor, groupByProject } from "./darkfactory-format.js";

/** Machine-wide overview of every Claude Code session ("agent"). */
@injectable()
export class SpexrDarkfactoryWidget extends ReactWidget {
  static readonly ID = "spexr.view.darkfactory";

  @inject(SpexrDarkfactoryServiceProxy) private readonly service!: SpexrDarkfactoryService;
  @inject(SpexrDarkfactoryClientDispatcher) private readonly client!: SpexrDarkfactoryClientDispatcher;
  @inject(WorkspaceService) private readonly workspace!: WorkspaceService;
  @inject(ClipboardService) private readonly clipboard!: ClipboardService;

  private agents: AgentSession[] = [];
  private summaries = new Map<string, string>();

  @postConstruct()
  protected init(): void {
    this.id = SpexrDarkfactoryWidget.ID;
    this.title.label = "Darkfactory";
    this.title.caption = "All Claude agents at work";
    this.title.closable = true;
    this.title.iconClass = "codicon codicon-server-process";
    this.addClass("spexr-darkfactory");
    this.client.onAgentsChanged$((agents) => this.setAgents(agents));
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    this.setAgents(await this.service.listAgents());
  }

  private setAgents(agents: AgentSession[]): void {
    this.agents = agents;
    this.update();
    for (const a of agents) void this.loadSummary(a);
  }

  private async loadSummary(a: AgentSession): Promise<void> {
    const s = await this.service.summarize(a.sessionId);
    this.summaries.set(a.sessionId, s.text);
    this.update();
  }

  protected render(): React.ReactNode {
    const now = Date.now();
    const groups = groupByProject(this.agents);
    if (groups.length === 0) {
      return <div className="spexr-df-empty">No Claude agents found. Start a session to see it here.</div>;
    }
    return (
      <div className="spexr-df-root">
        {groups.map((g) => (
          <section className="spexr-df-group" key={g.projectPath}>
            <header className="spexr-df-group-head">
              <span className="spexr-df-project">{g.projectName}</span>
              <code className="spexr-df-path">{g.projectPath}</code>
              <span className="spexr-df-actions">
                <button onClick={() => this.openInSpexr(g.projectPath)}>Open in SPEXR</button>
                <button onClick={() => this.service.revealInFileManager(g.projectPath)}>Reveal</button>
                <button onClick={() => this.clipboard.writeText(g.projectPath)}>Copy path</button>
              </span>
            </header>
            {g.sessions.map((a) => (
              <article className="spexr-df-card" key={a.sessionId}>
                <span className="spexr-df-led" style={{ background: stateColor(a.state) }} title={stateLabel(a.state)} />
                {a.gitBranch && <span className="spexr-df-branch">{a.gitBranch}</span>}
                <span className="spexr-df-summary">{this.summaries.get(a.sessionId) ?? a.lastPrompt}</span>
                <span className="spexr-df-meta">
                  {a.mode && <em>{a.mode}</em>}
                  {a.permissionMode && <em>{a.permissionMode}</em>}
                  <time>{relativeTime(a.lastActivityMs, now)}</time>
                </span>
              </article>
            ))}
          </section>
        ))}
      </div>
    );
  }

  private async openInSpexr(projectPath: string): Promise<void> {
    await this.workspace.open(new URI(`file://${projectPath}`));
  }
}
```

- [ ] **Step 2: Add styles**

Create `packages/theia-extensions/src/browser/darkfactory/darkfactory.css` (imported by the widget or the frontend module — follow how smart-search styles are loaded in this repo) with the editorial dark palette:

```css
.spexr-darkfactory {
  --spexr-df-live: #b388ff;
  --spexr-df-idle: #6b7280;
  --spexr-df-archived: #374151;
  padding: 16px;
  overflow: auto;
}
.spexr-df-group { margin-bottom: 24px; }
.spexr-df-group-head { display: flex; align-items: baseline; gap: 12px; }
.spexr-df-project { font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }
.spexr-df-path { font-family: var(--theia-code-font-family); opacity: 0.6; font-size: 11px; }
.spexr-df-card { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid var(--theia-editorWidget-border); }
.spexr-df-led { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.spexr-df-card:has(.spexr-df-led[title="Live"]) .spexr-df-led { animation: spexr-df-pulse 1.6s ease-in-out infinite; }
@keyframes spexr-df-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.3; } }
.spexr-df-summary { flex: 1; }
.spexr-df-meta { display: flex; gap: 8px; opacity: 0.7; font-size: 11px; }
```

Match the existing convention for loading CSS in this package (the smart-search widget shows how). Adjust selectors to the repo's approach if styles are injected differently.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @spexr/theia-extensions typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/theia-extensions/src/browser/darkfactory/darkfactory-widget.tsx packages/theia-extensions/src/browser/darkfactory/darkfactory.css
git commit -m "feat(darkfactory): agent overview widget"
```

### Task 10: View contribution + wiring

**Files:**
- Create: `packages/theia-extensions/src/browser/darkfactory/darkfactory-view-contribution.ts`
- Modify: `packages/theia-extensions/src/browser/spexr-frontend-module.ts`

**Interfaces:**
- Consumes: everything from Tasks 7–9.
- Produces: `SpexrDarkfactoryViewContribution` (opens the tab, command `spexr.view.darkfactory.toggle`).

- [ ] **Step 1: Write the view contribution (mirrors `welcome-view-contribution.ts`)**

```ts
import { injectable } from "@theia/core/shared/inversify";
import { AbstractViewContribution } from "@theia/core/lib/browser";
import { SpexrDarkfactoryWidget } from "./darkfactory-widget.js";

export const DARKFACTORY_VIEW_ID = SpexrDarkfactoryWidget.ID;

@injectable()
export class SpexrDarkfactoryViewContribution extends AbstractViewContribution<SpexrDarkfactoryWidget> {
  constructor() {
    super({
      widgetId: DARKFACTORY_VIEW_ID,
      widgetName: "Darkfactory",
      defaultWidgetOptions: { area: "main", rank: 3 },
      toggleCommandId: "spexr.view.darkfactory.toggle",
      toggleKeybinding: "ctrlcmd+shift+d",
    });
  }
}
```

- [ ] **Step 2: Wire in `spexr-frontend-module.ts`**

Add imports:

```ts
import { SpexrDarkfactoryWidget } from "./darkfactory/darkfactory-widget.js";
import { SpexrDarkfactoryViewContribution } from "./darkfactory/darkfactory-view-contribution.js";
import { SpexrDarkfactoryServiceProxy, DARKFACTORY_SERVICE_PATH } from "./darkfactory/darkfactory-service-proxy.js";
import { SpexrDarkfactoryClientDispatcher, SpexrDarkfactoryClientToken } from "./darkfactory/darkfactory-client.js";
```

Inside the module callback (mirroring the Welcome tab + the search proxy-with-client):

```ts
bindViewContribution(bind, SpexrDarkfactoryViewContribution);
bind(SpexrDarkfactoryWidget).toSelf();
bind(WidgetFactory)
  .toDynamicValue((ctx) => ({
    id: SpexrDarkfactoryWidget.ID,
    createWidget: () => ctx.container.get(SpexrDarkfactoryWidget),
  }))
  .inSingletonScope();

bind(SpexrDarkfactoryClientDispatcher).toSelf().inSingletonScope();
bind(SpexrDarkfactoryClientToken).toService(SpexrDarkfactoryClientDispatcher);
bind(SpexrDarkfactoryServiceProxy)
  .toDynamicValue((ctx) => {
    const connection = ctx.container.get(WebSocketConnectionProvider);
    const client = ctx.container.get(SpexrDarkfactoryClientDispatcher);
    return connection.createProxy(DARKFACTORY_SERVICE_PATH, client);
  })
  .inSingletonScope();
```

(Confirm `WebSocketConnectionProvider` is already imported in this module — the agent/search proxies use it.)

- [ ] **Step 3: Typecheck + full test suite**

Run: `pnpm --filter @spexr/theia-extensions typecheck && pnpm --filter @spexr/theia-extensions test`
Expected: PASS; 76 existing + new tests green.

- [ ] **Step 4: Build the desktop bundle**

Run: `pnpm --filter @spexr/desktop build` (or the repo's documented build command).
Expected: webpack build succeeds (backend + frontend bundles include the new files).

- [ ] **Step 5: Manual end-to-end verification**

Launch SPEXR. Open the Darkfactory tab (Cmd+Shift+D). Verify:
- Cards appear grouped by project for machine-wide sessions.
- A session currently running in a terminal shows the pulsing Live light; others show Idle.
- Each card fills in a one-line summary shortly after load.
- "Open in SPEXR" opens that folder (its own window); "Reveal" opens the OS file manager; "Copy path" copies.
- Starting/stopping a `claude` session updates the list within a few seconds.

- [ ] **Step 6: Commit**

```bash
git add packages/theia-extensions/src/browser/darkfactory/darkfactory-view-contribution.ts packages/theia-extensions/src/browser/spexr-frontend-module.ts
git commit -m "feat(darkfactory): register tab, command, and RPC wiring"
```

---

## Self-review notes (for the executor)

- **Liveness poll (~4s):** the design mentions a periodic liveness poll in addition to `fs.watch`. This plan implements the `fs.watch` push; if process start/stop without a transcript write must reflect faster, add a `setInterval(() => this.client?.onAgentsChanged(await this.listAgents()), 4000)` guarded by `setClient`, and clear it in `dispose()`. Left out of the core tasks to keep the first cut simple (YAGNI) — add only if manual verification shows stale live state.
- **`cwd` absence:** sessions whose transcript has no `cwd` are skipped (no reliable project path). Acceptable per design.
- **Archived toggle:** `listAgents(includeArchived)` exists; the widget currently always calls the default (idle+live). A later slice can add the toggle control.
