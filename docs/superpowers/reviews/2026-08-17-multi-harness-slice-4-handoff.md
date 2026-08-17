# Multi-harness Slice 4 — Planning handoff (adversarial review input)

> **What is this file.** Handoff report for the adversarial reviewer of the
> **planning artifacts** for `feat/multi-harness-opencode` Slice 4 (Darkfactory
> opencode tiles + resume). Audience: the reviewer agent. Owner: marcello.barile.
> Artifacts under review: contract
> `docs/specs/0013-harness-adapter-slice-4.md` and plan
> `docs/superpowers/plans/2026-08-17-multi-harness-slice-4.md`. Design:
> `docs/superpowers/specs/2026-08-17-multi-harness-opencode-design.md`; R1 spike
> (resolved): `docs/superpowers/specs/2026-08-17-opencode-enumeration-spike.md`;
> Slice 1 contract: `docs/specs/0012-harness-adapter-slice-1.md`.

## Status

**Planning complete, implementation not started.** No code was written in this
session. Working tree clean at commit `3df892d` (branch
`feat/multi-harness-opencode`). The plan is execution-ready for a
subagent-driven run; nothing in it has been verified against the codebase
beyond the reads listed below.

## What was done this session

1. Re-established context from: spec 0012, the design doc (incl. the resolved
   R1 section), the R1 spike, the Slice 1 handoff report, and the current code
   (`common/harness/*`, `node/darkfactory/*`, `browser/darkfactory/
   darkfactory-terminal-manager.ts`, `common/darkfactory-protocol.ts`).
2. Three scope decisions were made with the user (recorded here for the
   reviewer):
   - **Interface extension:** `followSession` is added to `HarnessAdapter` in
     Slice 4 (not deferred to Slice 5), with an opencode fail-fast stub; the
     backend does not call it yet. Rationale: avoid re-opening the interface in
     Slice 5.
   - **Backend wiring:** registry-driven — the backend consumes
     `installedHarnesses`/`resolveActiveHarness` (Slice 1's currently
     test-only registry) and merges `listSessions()` from every installed
     harness. Both installed harnesses are scanned; no user preference needed
     for the wall.
   - **Transcript strategy:** `listSessions` is the cheap `opencode db` query;
     `opencode export` is lazy, only for sessions inside the existing
     `RECENT_LIMIT` cut — parity with Claude's bounded-read discipline.
3. Wrote contract 0013 (6 ACs) + plan (7 tasks), committed as `3df892d`.

## Reviewer attention points

1. **Contract/code consistency.** The ACs reference existing code by name
   (`scanDisk`, `startFollow`, `RECENT_LIMIT`, `liveProjectDirs`,
   `classifySession`). Verify each reference is accurate against the current
   tree — e.g. AC-2 says `claudeHarness.listSessions` "walks the config dirs
   exactly as today's `scanDisk` does"; `scanDisk` is a private method of
   `SpexrDarkfactoryBackendService` (spexr-darkfactory-backend-service.ts:276),
   so Task 2's extraction step must not change its observable behavior.
2. **`HarnessSessionRef` shape.** AC-1 leaves the exact fields to the plan
   ("neutral: sessionId, projectPath, mtimeMs, harness-specific payload"). The
   reviewer should flag if a concrete shape is needed in the contract for
   testability; the plan does not pin one.
3. **Opencode `interactive: true` hardcode** (AC-3). The Claude pipeline uses
   `interactive` to filter SDK/one-shot sessions out of the wall. Opencode has
   no such flood today, but if it ever gains a headless mode the wall will show
   it. Acceptable for Slice 4; flag as a known limitation if you disagree.
4. **Resume-harness selection by id shape** (AC-5). UUID regex → claude,
   `ses_…` → opencode. This duplicates the two harnesses' `isResumableId`
   checks in the browser. Alternative: the backend could tag each tile with its
   harness id (protocol change). The contract chose no protocol change; flag if
   you think the tag is worth it.
5. **`planFocus` for opencode** (Task 5): always resumable, `configDir: ""`.
   Verify this matches how the frontend consumes `FocusPlan.configDir`
   (darkfactory-terminal-manager.ts:112 falls back to a preference — confirm
   the empty string flows correctly).
6. **Schema coupling.** The `opencode db` SELECT is pinned to opencode 1.18.13
   columns (spike). Failure degrades to "no opencode tiles" (empty list), never
   an error — verify AC-3's "never rejects" is testable as written.
7. **Slice 1 status.** Spec 0012 still says `in-progress` (not merged to main).
   Slice 4 stacks on it; the branch is not shippable until Slice 1 merges.
   Confirm the reviewer treats both as one review unit.

## Known limitations / assumptions

- No implementation, so no verification evidence (typecheck/lint/test runs)
  exists for Slice 4 yet — the gate is defined in the plan's ground rules and
  AC-6.
- `opencode` CLI facts are from the 2026-08-17 spike on opencode 1.18.13; a
  newer install could differ (mitigated per the spike).
- The plan assumes `execFile("opencode", …)` resolves via PATH in the backend's
  environment; if the user's `opencode` is only on their login-shell PATH, the
  backend may need the same robust resolution Claude uses
  (`resolveClaudeExecutableRobust`). Not pinned in the contract — flag.
