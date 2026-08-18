# Multi-harness Slice 4 — Darkfactory opencode tiles + resume

> **What is this file.** Step-by-step implementation plan for Slice 4 (contract:
> `docs/specs/0013-harness-adapter-slice-4.md`). Audience: the implementer
> (human or subagent). Owner: marcello.barile. Branch: `feat/multi-harness-opencode`
> (stacked on Slice 1's commits; Slice 1 is not yet merged to main).

## Ground rules

- TDD for the new opencode logic; test-after for pure moves (shims, type
  relocation). Every task ends with `pnpm run typecheck && pnpm run lint &&
  pnpm exec vitest run` green in `packages/theia-extensions`.
- One commit per task, Conventional Commits. No behavior change to the Claude
  path at any step (AC-6 is checked continuously, not just at the end).
- The `opencode db` SELECT string is hardcoded exactly as in the spike — never
  interpolate user/SPEXR input into it.

## Tasks

### Task 1 — Relocate `ParsedTranscript` to common + shim

- [x] Move `ParsedTranscript` interface from `node/darkfactory/transcript-parser.ts`
      to `common/harness/harness-types.ts`.
- [x] `node/darkfactory/transcript-parser.ts` re-exports it (one-line shim, as in
      Slice 1's resume-args shim). All existing importers keep working.
- [x] Verify: typecheck + lint + full vitest green; no diff in test output.

Commit: `refactor(harness): move ParsedTranscript to common with re-export shim`

### Task 2 — Extend `HarnessAdapter` + `ClaudeHarness` (AC-1, AC-2)

- [x] Add to `HarnessAdapter`: `listSessions(): Promise<HarnessSessionRef[]>`,
      `parseTranscript(ref: HarnessSessionRef): Promise<ParsedTranscript>`,
      `followSession(id: string): FollowHandle`. Define `HarnessSessionRef`
      (neutral: `sessionId`, `projectPath`, `mtimeMs`, harness-specific payload)
      and `FollowHandle` (`start(): void; stop(): void`) in `harness-types.ts`.
- [x] `claudeHarness.listSessions`: extract today's `scanDisk` body from the
      backend service into a reusable function (e.g.
      `node/darkfactory/session-scan.ts` or keep in backend and inject); the
      harness member wraps it and maps to `HarnessSessionRef`.
- [x] `claudeHarness.parseTranscript`: call existing `parseTranscript(lines)` on
      the ref's bounded read; entries normalization is identity for Claude.
- [x] `claudeHarness.followSession`: wrap the existing `fs.watch` tail logic
      (extracted from `startFollow`) into a `FollowHandle`.
- [x] Backend service still behaves identically — it may keep using its own
      private scan for now; Task 5 routes it through the harness. Existing
      backend tests pass unchanged.

Commit: `feat(harness): add session members to HarnessAdapter; ClaudeHarness parity`

### Task 3 — `OpencodeHarness` (AC-3)

- [x] New `common/harness/opencode-harness.ts`.
- [x] `isResumableId`: `/^ses_[A-Za-z0-9]+$/`.
- [x] `buildResumeArgs(id, fork)`: `["--session", id]` + `"--fork"` when fork.
- [x] `listSessions()`: `execFile("opencode", ["db", "--format", "json",
      "SELECT id, directory, parent_id, title, agent, model, time_created,
      time_updated FROM session ORDER BY time_updated DESC"])`; parse JSON rows →
      `HarnessSessionRef` (`sessionId: row.id`, `projectPath: row.directory`,
      `mtimeMs: row.time_updated`). Catch all failures → `[]`.
- [x] `parseTranscript(ref)`: `execFile("opencode", ["export", ref.sessionId])`,
      capture full stdout, JSON.parse; map messages/parts to Claude entry shape
      (`{message:{role, content:[blocks]}}`): user/assistant text parts → `text`
      blocks; tool parts → `tool_use` blocks (`name`, `input`); then run the
      existing `parseTranscript` over the normalized lines (or compute fields
      directly) to produce `ParsedTranscript` with `cwd: ref.projectPath`,
      `interactive: true`.
- [x] `followSession`: throw `Error("not implemented")`.
- [x] Tests (`opencode-harness.test.ts`) with captured fixtures: id whitelist,
      resume args ±fork, listSessions fixture + empty/failure → `[]`,
      parseTranscript fixture (goal, userTurns, lastTool, interactive).

Commit: `feat(harness): add OpencodeHarness (db enumeration, export parsing, resume args)`

### Task 4 — Entry normalization for opencode exports

- [x] If Task 3's direct-field computation diverges from what
      `turns.ts`/`action-distiller.ts`/`session-state.ts` need, add a pure
      normalizer `opencodeExportToEntries(json): TurnEntry[]` (Claude entry
      shape) in `common/harness/` or `node/darkfactory/`, and have
      `parseTranscript` feed it through the existing consumers.
- [x] Tests: a captured export maps to entries that produce correct
      `distillAction` / `recentActions` / `lastTurn` outputs (reuse existing
      consumer tests as oracles).

Commit: `feat(harness): normalize opencode export to transcript entries`

### Task 5 — Backend registry wiring (AC-4)

- [x] Add a `DetectFn` seam to `DarkfactoryDeps` (default: resolve each harness
      binary via login-shell `command -v`, cached).
- [x] Backend resolves `installedHarnesses([claudeHarness, opencodeHarness],
      detect)`; `listTranscripts` merges every installed harness's
      `listSessions()`; `liveDirs` uses the union of installed harnesses'
      `processNames()`.
- [x] Tile pipeline consumes the merged refs: Claude refs keep their bounded
      read; opencode refs parse lazily (only within `RECENT_LIMIT`), via
      `harness.parseTranscript`.
- [x] `planFocus` for opencode sessions: `configDir` is `""` (no config-dir
      override); resumable = always (opencode has no per-account dir mismatch).
- [x] Tests: Claude-only merge identical to today; two-harness merge; opencode
      enumeration failure → opencode contributes nothing, Claude tiles intact.

Commit: `feat(darkfactory): route backend scan through HarnessRegistry`

### Task 6 — Terminal manager per-session harness (AC-5)

- [x] `darkfactory-terminal-manager.ts`: select harness by id shape
      (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` →
      claude, `ses_…` → opencode); use that harness's `isResumableId` /
      `buildResumeArgs`.
- [x] Opencode resume shell line: `cd <projectPath>; opencode --session <id>
      [--fork]; exec "$SHELL" -i` (login shell, no `CLAUDE_CONFIG_DIR` export).
- [x] Terminal id stays `spexr-df-${sessionId}` (unique per session across
      harnesses — ids can't collide: UUID vs `ses_…`).
- [x] Tests: opencode line shape; claude line unchanged; invalid id → undefined.

Commit: `feat(darkfactory): resume terminals select harness per session`

### Task 7 — Verification sweep + docs

- [x] Full gate: `pnpm run typecheck && pnpm run lint && pnpm exec vitest run`.
- [x] Manual check (if opencode installed): open the wall, confirm opencode
      tiles appear with goal/action line; click one → resume terminal works.
- [x] Update design doc: mark Slice 4 status; note `followSession` stub is
      consumed in Slice 5.
- [x] Mark spec 0013 checkboxes/status per repo convention (`in-progress` until
      merged).

Commit: `docs(spec): mark 0013 slice 4 shipped; complete plan checkboxes`

## Out of scope (explicit)

- Live-follow + AI summary for opencode → Slice 5 (consumes the
  `followSession` stub).
- Agent-terminal launch, `spexr.agent.harness`, switch command → Slices 2–3.
- Project-memory linking → Slice 6.
