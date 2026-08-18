---
slug: 0013-harness-adapter-slice-4
title: Darkfactory opencode tiles + resume (multi-harness Slice 4)
status: in-progress
createdAt: 2026-08-17
workflowStep: plan
updatedAt: 2026-08-18
---
> **What is this file.** Implementation contract for Slice 4 of multi-harness
> support — opencode sessions visible and resumable on the Darkfactory wall.
> Audience: SPEXR contributors. Owner: marcello.barile. Companion files: the
> design and trade-offs live in
> `docs/superpowers/specs/2026-08-17-multi-harness-opencode-design.md`; the R1
> enumeration spike (resolved) lives in
> `docs/superpowers/specs/2026-08-17-opencode-enumeration-spike.md`; the
> step-by-step plan lives in
> `docs/superpowers/plans/2026-08-17-multi-harness-slice-4.md`. Slice 1's
> contract (the seam this slice extends) is
> `docs/specs/0012-harness-adapter-slice-1.md`. This spec is authoritative where
> it disagrees with the design.

## Goal

Extend the `HarnessAdapter` seam so the Darkfactory wall enumerates, parses, and
resumes **opencode** sessions with functional parity to Claude: opencode tiles
appear on the wall (state, goal, action line, recent actions), and clicking one
opens a working `opencode --session <id>` resume terminal. The backend is
routed through the `HarnessRegistry` (currently referenced only by its unit
tests — this slice is its first live consumer).

## Non-goals

- No Agent-terminal launch for opencode (Slices 2–3). The wall's resume
  terminal launches `opencode` directly; the SPEXR Agent terminal remains
  Claude-only until Slice 2.
- No live-follow streaming or AI summary for opencode (Slice 5). The
  `followSession` member is added to the interface this slice, but its
  opencode implementation is a fail-fast stub; the backend does not call it yet.
- No `spexr.agent.harness` preference or "Switch Agent Harness" command
  (Slice 2). Harness selection for Darkfactory is auto: whichever harnesses are
  installed are both scanned, so no user choice is needed for the wall.
- No opencode project-memory linking (Slice 6).

## Acceptance Criteria

- **AC-1 Interface extension.** `common/harness/harness-types.ts` adds to
  `HarnessAdapter`: `listSessions(): Promise<HarnessSessionRef[]>`,
  `parseTranscript(ref: HarnessSessionRef): Promise<ParsedTranscript>`,
  `followSession(id: string): FollowHandle`. `ParsedTranscript` and
  `FollowHandle` move to `common/harness/` (re-exported from
  `node/darkfactory/transcript-parser.ts` via a shim, as in Slice 1). Existing
  members (`id`, `processNames`, `isResumableId`, `buildResumeArgs`) unchanged.
- **AC-2 ClaudeHarness parity.** `claudeHarness.listSessions` walks the config
  dirs exactly as today's `scanDisk` does (same `TranscriptRef` fields, same
  bounded-read); `claudeHarness.parseTranscript` delegates to the existing
  `parseTranscript(lines)`; `claudeHarness.followSession` wraps the existing
  `fs.watch` tail. The pre-existing backend test suite passes unchanged.
- **AC-3 OpencodeHarness.** New `common/harness/opencode-harness.ts` exports
  `opencodeHarness: HarnessAdapter`:
  - `processNames() === ["opencode"]`.
  - `isResumableId` is the whitelist `/^ses_[A-Za-z0-9]+$/` (the id reaches a
    shell command line; the regex doubles as the sanitizer).
  - `buildResumeArgs(id, fork)` → `["--session", id]` plus `"--fork"` when
    `fork` (opencode flags are not symmetric with Claude's — verified in the
    spike; no `--fork-session`).
  - `listSessions()` runs one `opencode db --format json "SELECT id, directory,
    parent_id, title, agent, model, time_created, time_updated FROM session
    ORDER BY time_updated DESC"` call (hardcoded query, no interpolation) and
    maps rows to `HarnessSessionRef` with `directory` as the tile group. A
    failed/empty result resolves to `[]` ("enumeration unavailable"), never
    rejects — the caller falls back to modified-time-only liveness, same
    backstop Claude uses when process scanning fails.
  - `parseTranscript(ref)` runs `opencode export <id>` (full stdout captured
    before parsing — piping truncates mid-JSON) and maps the
    `{info, messages:[{info:{role}, parts:[{type,text}]}]}` shape to
    `ParsedTranscript`: `cwd` from `ref.directory`, `goal`/`lastPrompt` from the
    first/last genuine user `text` part, `userTurns` counted, `lastTool` from
    the last `tool` part, `interactive: true` (opencode TUI sessions are all
    interactive; there is no SDK one-shot flood to filter).
  - `followSession(id)` throws `Error("not implemented")` — Slice 5.
- **AC-4 Registry wiring (backend).** The Darkfactory backend service resolves
  its harness set via `installedHarnesses([claudeHarness, opencodeHarness],
  detect)` with an injected `DetectFn` seam (default: `command -v` for the
  harness binary), and merges `listSessions()` results from every installed
  harness into the existing tile pipeline. Live process dirs come from
  `liveProjectDirs(undefined, undefined, [...all installed harnesses'
  processNames()])`. The Claude scan path is byte-identical to today when
  opencode is not installed.
- **AC-5 Terminal manager wiring.** `darkfactory-terminal-manager.ts` selects
  the resume harness per session (by id shape: UUID → claude, `ses_…` →
  opencode) and uses that harness's `isResumableId` / `buildResumeArgs`. The
  resume shell line for opencode is `opencode --session <id> [--fork]` run in a
  login shell with `cd <projectPath>` (no `CLAUDE_CONFIG_DIR` export — opencode
  has no config-dir override; the session's `directory` is authoritative).
- **AC-6 No behavior change for Claude.** With only Claude installed, every
  tile field, state classification, resume terminal, and follow behaves exactly
  as before. `pnpm run typecheck`, `pnpm run lint`, and full
  `vitest run` for `packages/theia-extensions` pass; every pre-existing test
  passes unchanged.

## Architecture

New / modified modules:

| File | Change |
|------|--------|
| `common/harness/harness-types.ts` | + `listSessions`, `parseTranscript`, `followSession`; `HarnessSessionRef`, `FollowHandle` types (AC-1) |
| `common/harness/opencode-harness.ts` | **new** — `opencodeHarness` descriptor (AC-3) |
| `common/harness/claude-harness.ts` | + the three new members delegating to existing helpers (AC-2) |
| `node/darkfactory/transcript-parser.ts` | `ParsedTranscript` → re-export shim from `common/harness/` (AC-1) |
| `node/darkfactory/spexr-darkfactory-backend-service.ts` | registry-driven multi-harness scan + merged tiles (AC-4) |
| `browser/darkfactory/darkfactory-terminal-manager.ts` | per-session harness selection for resume (AC-5) |

Key seam decisions:

- **`HarnessSessionRef` is the neutral tile input.** Claude's existing
  `TranscriptRef` (with `readLines`) and opencode's db row + export both map to
  it. The backend's tile pipeline (`classifySession`, `distillAction`,
  `recentActions`, `lastActionFailed`) consumes `ParsedTranscript` + entries
  regardless of harness, so no tile logic forks per harness.
- **Opencode entries are normalized to Claude's entry shape**
  (`{message:{role,content}}` blocks) by `parseTranscript`, so the existing
  `turns.ts` / `action-distiller.ts` / `session-state.ts` consumers work
  unmodified. Tool parts map to `tool_use` blocks (name + input); text parts to
  `text` blocks; tool results (when present in the export) to `tool_result`.
- **Enumeration is one CLI call per scan** for opencode (the spike's chosen
  strategy); transcript export is lazy — only for sessions that make the
  `RECENT_LIMIT` cut, matching Claude's bounded-read discipline.
- **Schema coupling is contained**: the `opencode db` SELECT is hardcoded to the
  minimal column set verified against opencode 1.18.13; a future schema change
  degrades to "no opencode tiles" (empty list), never an error, per the spike's
  mitigation.

## Testing strategy

- `opencode-harness.test.ts`: `isResumableId` whitelist (accept/reject cases
  incl. shell-metachar rejection); `buildResumeArgs` with/without fork;
  `listSessions` against a captured `opencode db` JSON fixture (incl. the
  empty/failure → `[]` path); `parseTranscript` against a captured `opencode
  export` JSON fixture (goal/turns/lastTool/interactive assertions).
- Backend: registry-driven merge with one + two installed harnesses; Claude-only
  path unchanged (existing suite is the gate).
- Terminal manager: opencode resume line shape (`cd <dir>; opencode --session
  <id> …`), per-session harness selection by id shape.
