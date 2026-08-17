# Multi-harness Slice 1 — End-of-work report (adversarial review input)

> **What is this file.** Handoff report for the adversarial reviewer of
> `feat/multi-harness-opencode` (Slice 1: `HarnessAdapter` extraction). Audience:
> the reviewer agent. Owner: marcello.barile. Contract under review:
> `docs/specs/0012-harness-adapter-slice-1.md`; design:
> `docs/superpowers/specs/2026-08-17-multi-harness-opencode-design.md`; plan:
> `docs/superpowers/plans/2026-08-17-multi-harness-slice-1.md`.

## Status

Complete and green. All 7 plan tasks done; spec 0012 status `in-progress`
(reserved `shipped`/`ship` until merged to main and available to users).
Working tree clean at commit `b2e8e1b` (branch `feat/multi-harness-opencode`).

## Scope (and explicit non-scope)

Slice 1 introduces the `HarnessAdapter` seam with a live `ClaudeHarness` and a
pure `HarnessRegistry`, wired into two live call sites, with **zero observable
behavior change**. Deliberately NOT in this slice (deferred to Slice 2):
`OpencodeHarness`, Agent-terminal launch rerouting, `spexr.agent.harness`
preference / switch command / UI, account-profile detection behind the adapter,
and the "preferred harness not installed" warning.

## Commits under review

| Commit | Content |
|--------|---------|
| `8433b27` | Task 1 — `HarnessAdapter` interface + `HarnessId` (`common/harness/harness-types.ts`) |
| `0414b9c` | Task 2 — resume helpers moved to `common/harness/resume-args.ts`; `node/darkfactory/resume-args.ts` → re-export shim |
| `3937693` | Task 3 — `claudeHarness` descriptor delegating to the moved helpers |
| `7d87d0b` | Task 4 — `installedHarnesses` / `resolveActiveHarness` + `DetectFn` seam |
| `36ec8bd` | Task 5 — `parseAgentPids(psStdout, names)`; `parseClaudePids` wrapper; `liveProjectDirs` optional `names` (default `["claude"]`) |
| `27893ad` | Task 6 — backend live-scan default feeds `claudeHarness.processNames()`; terminal manager drops inline UUID/resume dup, uses `claudeHarness.isResumableId` / `buildResumeArgs` |
| `b2e8e1b` | Docs only — plan checkboxes + spec status (not part of the code diff) |

## Verification evidence (run 2026-08-17, post-Task 6)

- `pnpm run typecheck` in `packages/theia-extensions`: clean.
- `pnpm run lint`: clean.
- `pnpm exec vitest run`: **33 files / 270 tests passed**, zero failures.
  Pre-existing suites (`process-scanner.test.ts`, `resume-args.test.ts`,
  `spexr-darkfactory-backend-service.test.ts`) pass unchanged via the shim.
- Dead-code check: `grep -rn claudeHarness packages/theia-extensions/src --include='*.ts'`
  outside `common/harness/` and tests returns exactly the two Task 6 call sites
  (`spexr-darkfactory-backend-service.ts`, `darkfactory-terminal-manager.ts`).

## Reviewer attention points

1. **Behavior-preservation is the whole contract.** Highest-value check: every
   wiring edit computes byte-identical values to the pre-abstraction code.
   - `claudeHarness.processNames()` → `["claude"]` (scanner default unchanged).
   - `buildResumeArgs` still throws on non-UUID; in the terminal manager the
     `isResumableId` guard runs first, so the throw path is unreachable — same as before.
2. **Dependency direction** (`common/` must not import `node/`). Verify the shim
   at `node/darkfactory/resume-args.ts` is the only bridge and that no `common/`
   file imports upward.
3. **Registry selection rules** (spec AC-4): none → `undefined`; one → that one
   (preference ignored); several → preferred when installed, else first
   installed. Tests use full stub literals — confirm no unsafe casts slipped in.
4. **Interface minimality** (AC-1): exactly `id`, `processNames()`,
   `isResumableId`, `buildResumeArgs`. Flag any dead stubs or scope creep toward
   Slice 2 members.
5. **Shim correctness**: `resume-args.test.ts` passes via the re-export; confirm
   no other importer of the old path was missed.

## Known limitations / assumptions

- Registry (`installedHarnesses` / `resolveActiveHarness`) is currently
  referenced only by its unit tests — no live call site yet. This is intentional:
  it has no purpose until Slice 2 adds a second harness and the preference
  setting. The spec's no-dead-code gate (AC-6) covers `claudeHarness` only, by design.
- No `OpencodeHarness`, no launch rerouting — see non-scope above.
