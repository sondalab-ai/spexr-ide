# Multi-harness Slice 4 — End-of-work report (adversarial review input)

> **What is this file.** Handoff report for the adversarial reviewer of
> `feat/multi-harness-opencode` (Slice 4: Darkfactory opencode tiles + resume).
> Audience: the reviewer agent. Owner: marcello.barile. Contract under review:
> `docs/specs/0013-harness-adapter-slice-4.md`; design:
> `docs/superpowers/specs/2026-08-17-multi-harness-opencode-design.md`; plan:
> `docs/superpowers/plans/2026-08-17-multi-harness-slice-4.md`. Slice 4 stacks on
> Slice 1 (contract `docs/specs/0012-harness-adapter-slice-1.md`, also unmerged) —
> review both as one unit.

## Status

Complete and green. All 7 plan tasks done; spec 0013 status `in-progress`
(reserved `shipped`/`ship` until merged to main and available to users).
Working tree clean at commit `6f3c3fe` (branch `feat/multi-harness-opencode`).

## Scope (and explicit non-scope)

Slice 4 extends the `HarnessAdapter` seam with session members
(`listSessions`, `parseTranscript`, `followSession`), adds a live
`OpencodeHarness`, routes the Darkfactory backend through the
`HarnessRegistry` (its first live consumer), and makes resume terminals select
the harness per session. Deliberately NOT in this slice: Agent-terminal launch
for opencode (Slices 2–3), live-follow streaming + AI summary for opencode
(Slice 5 — `followSession` is a fail-fast stub, the backend never calls it),
`spexr.agent.harness` preference / switch command, and project-memory linking
(Slice 6).

## Commits under review (Slice 4 only; Slice 1 commits are in its own handoff)

| Commit | Content |
|--------|---------|
| `3df892d` | Docs — contract 0013 + plan (not part of the code diff) |
| `ca00d67` | Task 1 — `ParsedTranscript` moved to `common/harness/harness-types.ts`; `transcript-parser.ts` re-export shim |
| `a3e9860` | Task 2 — `HarnessSessionRef`/`FollowHandle` types; `listSessions`/`parseTranscript`/`followSession` added to the interface; `ClaudeHarness` implements them (`scanClaudeTranscripts` extracted, bounded-read moved to `node/darkfactory/bounded-read.ts`) |
| `8b48a8b` | Task 3 — `OpencodeHarness`: `opencode db` enumeration, `opencode export` parsing, `ses_…` id whitelist, `--session`/`--fork` resume args |
| `b86f92b` | Task 4 — opencode export → Claude entry-shape normalization (tool names bash→Bash, inputs filePath→file_path) so the shared distiller/follow consumers work unmodified |
| `b7bf6c9` | Task 5 — backend routes through `installedHarnesses`; merged multi-harness tile pipeline; opencode sessions always resumable in `planFocus` |
| `6f3c3fe` | Task 6 — resume terminal manager selects harness by id shape (UUID → claude, `ses_…` → opencode); new unit tests |

## Verification evidence (run 2026-08-18, post-Task 6)

- `pnpm run typecheck` in `packages/theia-extensions`: clean.
- `pnpm run lint`: clean.
- `pnpm exec vitest run`: **35 files / 289 tests passed**, zero failures
  (baseline before Slice 4: 33 files / 270 tests; +2 files, +19 tests).
- Pre-existing suites pass unchanged in behavior; the backend test's fixture
  shape was updated to the new `UnifiedRef` wrapper (mechanical, same data).
- **Real-CLI e2e** (temporary vitest file against the installed opencode
  1.18.13, removed after running): `opencodeHarness.listSessions()` returned
  **72 sessions**; `parseTranscript` on the newest produced
  `{cwd: "/Users/marcello.barile/src/mine/spexr", interactive: true}` —
  enumeration + export parsing work end-to-end.

## Reviewer attention points

1. **Behavior-preservation for Claude (AC-6) is the whole contract.** The
   backend's tile pipeline now calls `harness.parseTranscript(ref)` instead of
   its inline `parseTranscript(lines)`. For Claude this round-trips
   entries → JSON lines → `parseTranscript`; verify it yields identical fields
   (goal/turns/mode/permissionMode/cwd) — the pre-existing backend tests are the
   gate, but they exercise a small fixture.
2. **`claudeHarness.listSessions` is currently unused by the backend** — the
   backend builds Claude `UnifiedRef`s directly in `defaultListTranscripts` (it
   needs the `TranscriptRef` for `transcriptPath`/`configDir`, which
   `HarnessSessionRef` deliberately does not carry). Both paths share
   `scanClaudeTranscripts`, so there is one source of truth; flag if you want
   the harness member to be the sole path.
3. **Opencode `interactive: true` hardcode** (AC-3). Claude uses `interactive`
   to filter SDK/one-shot sessions; opencode has no headless flood today, but a
   future headless mode would appear on the wall. Known limitation, accepted.
4. **Resume-harness selection by id shape** (AC-5) duplicates the two
   `isResumableId` checks in the browser instead of tagging tiles with their
   harness id (would need a protocol change). Chosen to keep the protocol stable;
   flag if you think the tag is worth it.
5. **Tool-name/input mapping** (Task 4): opencode's `bash/read/write/edit/…`
   map to Claude names and `filePath`→`file_path` so `distillAction`/
   `recentActions` render known verbs ("Running: …", "Editing …"). Unmapped tools
   pass through verbatim. Verify the mapping table covers the tools you care about.
6. **`opencode db` schema coupling** (spike R1). The SELECT is pinned to opencode
   1.18.13 columns; any failure/empty result resolves to `[]` → "no opencode
   tiles", never an error. Verify the never-rejects path is covered by tests.
7. **Default detect seam.** In production the backend's default detect reports
   only Claude installed (opencode detection via `command -v` is not wired yet —
   that arrives with Slices 2–3's preference/launch work). So opencode tiles
   appear only when a caller injects a detect that reports both. This is
   intentional scope control; flag if you expect auto-detection in Slice 4.

## Known limitations / assumptions

- `followSession` throws for both harnesses (Claude's follow stays in the
  backend service, opencode's is Slice 5) — the interface member exists so Slice
  5 doesn't re-open it.
- Opencode resume terminals launch bare `opencode` via the login shell; there is
  no `spexr.opencode.executable` preference yet (Slice 2).
- No manual wall verification was performed (requires a running Theia workbench);
  the e2e above covers the harness layer against the real CLI.
