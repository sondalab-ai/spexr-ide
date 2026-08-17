---
slug: 0012-harness-adapter-slice-1
title: HarnessAdapter extraction (multi-harness Slice 1)
status: shipped
createdAt: 2026-08-17
workflowStep: ship
updatedAt: 2026-08-17
---
> **What is this file.** Implementation contract for Slice 1 of multi-harness
> support — extracting a `HarnessAdapter` seam and a `ClaudeHarness` behind it,
> wired into live call sites, with zero behavior change. Audience: SPEXR
> contributors. Owner: marcello.barile. Companion files: the design and
> trade-offs live in `docs/superpowers/specs/2026-08-17-multi-harness-opencode-design.md`;
> the step-by-step plan lives in `docs/superpowers/plans/2026-08-17-multi-harness-slice-1.md`.
> This spec is authoritative where it disagrees with the design.

## Goal

Introduce the abstraction that later slices need to add `opencode`, without
changing any observable behavior. A `HarnessAdapter` interface captures the
harness-specific operations; `ClaudeHarness` implements it by delegating to
today's Claude logic; `HarnessRegistry` detects installed harnesses and resolves
the active one. The abstraction ships **referenced from live code**, not as dead
scaffolding.

## Non-goals

- No `OpencodeHarness` — this slice is Claude-only.
- No Agent-terminal launch rerouting (`claude-terminal-manager.ts`), no
  `spexr.agent.harness` preference, no switch command, no UI change. All Slice 2.
- No move of Claude's account-profile detection behind the adapter yet (Slice 2).

## Acceptance Criteria

- **AC-1 Interface.** `common/harness/harness-types.ts` exports `HarnessId`
  (`"claude" | "opencode"`) and `HarnessAdapter` with exactly: `id`,
  `processNames()`, `isResumableId(sessionId)`, `buildResumeArgs(sessionId, fork)`.
  No launch/session/memory members (added by later slices) — no dead stubs.
- **AC-2 Dependency direction.** The pure resume helpers move to
  `common/harness/resume-args.ts`; `node/darkfactory/resume-args.ts` becomes a
  one-line re-export shim. `common/` imports nothing from `node/`. The existing
  `resume-args.test.ts` passes unchanged via the shim.
- **AC-3 ClaudeHarness.** `common/harness/claude-harness.ts` exports a
  `claudeHarness: HarnessAdapter` whose methods return exactly what today's code
  computes: `processNames() === ["claude"]`, `isResumableId` is the UUID test,
  `buildResumeArgs` matches the legacy helper (`--resume <id>` [`--fork-session`]).
- **AC-4 Registry.** `common/harness/harness-registry.ts` exports
  `installedHarnesses` and `resolveActiveHarness` with an injected `DetectFn`
  seam. Selection: none installed → `undefined`; exactly one → that one
  (preference ignored); several → preferred when installed, else first installed.
  Covered by unit tests using full adapter stub literals (no unsafe casts).
- **AC-5 Scanner parametrization.** `process-scanner.ts` exports
  `parseAgentPids(psStdout, names)`; `parseClaudePids` becomes a
  `parseAgentPids(s, ["claude"])` wrapper; `liveProjectDirs` takes an optional
  `names` defaulting to `["claude"]`. Existing scanner tests pass unchanged.
- **AC-6 Live wiring (no dead code).** `claudeHarness` is referenced from live
  `src/` (not only tests): the Darkfactory backend's default live-scan feeds the
  name set from `claudeHarness.processNames()`, and the resume-terminal manager
  uses `claudeHarness.isResumableId` / `buildResumeArgs` in place of its inline
  duplicates. A `grep` for `claudeHarness` outside `common/harness/` and tests
  returns these call sites.
- **AC-7 No behavior change.** `pnpm run typecheck`, `pnpm run lint`, and the
  full `vitest run` for `packages/theia-extensions` pass; every pre-existing
  test passes **unchanged**.

## Architecture

New module group `packages/theia-extensions/src/common/harness/`:

| File | Role |
|------|------|
| `harness-types.ts` | `HarnessId`, `HarnessAdapter` interface (AC-1) |
| `resume-args.ts` | Moved pure resume helpers `isSessionId` / `buildResumeArgs` (AC-2) |
| `claude-harness.ts` | `claudeHarness` descriptor delegating to Claude logic (AC-3) |
| `harness-registry.ts` | `installedHarnesses` / `resolveActiveHarness` detect+select (AC-4) |

Modified live code:

| File | Change |
|------|--------|
| `node/darkfactory/resume-args.ts` | → re-export shim (AC-2) |
| `node/darkfactory/process-scanner.ts` | `parseAgentPids` + `names` param (AC-5) |
| `node/darkfactory/spexr-darkfactory-backend-service.ts` | default live-scan uses `claudeHarness.processNames()` (AC-6) |
| `browser/darkfactory/darkfactory-terminal-manager.ts` | inline resume dup → `claudeHarness` (AC-6) |
