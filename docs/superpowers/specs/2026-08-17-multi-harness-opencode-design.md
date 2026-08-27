---
slug: 2026-08-17-multi-harness-opencode
title: Multi-harness support — opencode alongside Claude
status: draft
createdAt: 2026-08-17
kind: design
---

> **What is this file.** Design and trade-off record for extending SPEXR to run
> [opencode](https://github.com/sst/opencode) as a first-class agent harness
> alongside Claude Code, across both the Agent terminal and the Darkfactory
> monitoring wall. Audience: SPEXR contributors. Owner: marcello.barile. This is
> a **design doc** (architecture, alternatives, risks, delivery slicing); it is
> not an implementation contract. Each delivery slice gets its own numbered
> contract spec under `docs/specs/` (starting at `0012`) and its own plan under
> `docs/superpowers/plans/`. Where a slice's contract spec and this design
> disagree, the contract spec is authoritative for that slice.

## Status legend

All behavior described here is **Planned (not delivered)** unless a line says
otherwise. No slice below is merged yet.

## Goal

Today "the agent" in SPEXR is hardwired to the `claude` CLI in roughly six
places — Agent-terminal launch, account-profile detection, system-prompt
injection, readiness detection, Darkfactory liveness/history/resume, and
project-memory linking. We want SPEXR to detect `opencode` when installed and
let it **coexist** with Claude: the user picks a harness (auto-selected when only
one is installed), and both the Agent terminal and Darkfactory work against the
chosen harness with full functional parity.

Nothing about the existing Claude behavior should change for existing users. The
opencode support is additive.

## Non-goals

- No simultaneous dual harness in one Agent terminal. One harness is active per
  workspace at a time; switching relaunches the single Agent terminal.
- No migration of existing `spexr.claude.*` preference values. They stay the
  Claude adapter's namespace; opencode gets a parallel `spexr.opencode.*`.
- No Windows-specific opencode liveness beyond what already exists for Claude
  (process scanning is posix-only; Windows falls back to modified-time recency).
- No reimplementation of opencode's own session store. We read it only through
  opencode's command-line interface (CLI), never by opening its SQLite database
  file directly.

## Verified opencode facts (v1.18.13, confirmed on this machine)

These drive the design; they were checked against the installed binary, not
recalled from memory.

- **Binary:** `opencode` (Homebrew, `/opt/homebrew/bin/opencode`). Process
  command name for `ps -Ao pid,comm` is `opencode`.
- **Launch:** bare `opencode [project]` starts the terminal UI (TUI). Relevant
  flags: `-c/--continue` (resume last session), `-s/--session <id>` (resume a
  specific session), `--fork` (fork on continue/session), `--agent <name>`
  (use a named agent), `--prompt <text>` (seed an initial message), `-m/--model`.
- **System-prompt injection:** opencode has **no** `--append-system-prompt`
  equivalent. Injection is file/config based: a named agent markdown file
  (`~/.config/opencode/agent/*.md` global or `.opencode/agent/*.md`
  project-local, selected with `--agent <name>`), or the config `instructions`
  array (a list of file paths merged into context). Confirmed the user's global
  config already uses `instructions: ["…/AGENTS.caveman.md"]`.
- **Sessions:** stored in a SQLite database at
  `~/.local/share/opencode/opencode.db` — **not** per-project JSON-lines files
  like Claude. Exposed via CLI: `opencode session list --format json
  [--max-count N]` and `opencode export <sessionID>` (session data as JSON).
- **Session scoping constraint:** `opencode session list` is **directory
  scoped** — it lists sessions for the current working directory, not all
  sessions globally. Claude's Darkfactory instead enumerates globally by walking
  `~/.claude*/projects/`. Global enumeration for opencode is therefore an open
  question (see Risks) resolved by a spike in the Darkfactory slice.
- **Resume id format:** an opencode session id is an opaque string, **not** a
  UUID. Claude's `buildResumeArgs` validates a UUID shape; opencode needs its own
  (looser) validation.

## Architecture

### The `HarnessAdapter` seam

A single interface captures every point where the code currently assumes Claude.
Two implementations back it: `ClaudeHarness` (wraps today's logic, no behavior
change) and `OpencodeHarness`. A `HarnessRegistry` detects installed harnesses
and resolves the active one.

```
interface HarnessAdapter {
  readonly id: "claude" | "opencode";

  // ── Agent terminal (launch) ──────────────────────────────
  detectInstalled(): boolean;                    // command -v <bin>
  resolveExecutable(): string | undefined;       // robust login-shell resolve
  detectProfiles(): HarnessProfile[];            // claude: CLAUDE_CONFIG_DIR aliases; opencode: default-only (initially)
  buildLaunchShellLine(profile, args): string;   // the `-i -l -c` line
  injectSystemPrompt(ctx): LaunchInject;         // claude: --append-system-prompt-file
                                                 // opencode: write .opencode/agent/spexr.md + --agent spexr
  isReady(tail): boolean;                         // readiness marker per harness
  terminalId(): string;                           // "spexr-claude" | "spexr-opencode"

  // ── Darkfactory (monitoring) ─────────────────────────────
  processNames(): string[];                       // ["claude"] | ["opencode"]
  listSessions(): Promise<SessionRef[]>;          // claude: scan jsonl; opencode: session list (CLI)
  parseTranscript(ref): Promise<ParsedTranscript>;// claude: jsonl turns; opencode: export JSON
  followSession(id): FollowHandle;                // claude: tail jsonl; opencode: poll export / server stream
  buildResumeArgs(id, fork): string[];            // claude: --resume UUID; opencode: --session <id>

  // ── Memory ───────────────────────────────────────────────
  linkProjectMemory(root, profile): Promise<Result>; // claude: ~/.claude symlink; opencode: instructions[] / AGENTS.md
}
```

Key seam decisions:

- **Terminal id is per-harness** (`spexr-claude` / `spexr-opencode`). Today
  `ClaudeTerminalManager` adopts an existing widget by id (`terminalService.getById`).
  Distinct ids prevent one harness from adopting the other's live widget when the
  user switches.
- **Readiness is per-harness.** `isClaudeReady` keys off a Claude-specific
  render marker; opencode needs its own (idle-quiet fallback already exists as a
  generic backstop).
- **Resume-args validation is per-harness.** UUID for Claude, opaque-string for
  opencode.

### Harness selection

- `HarnessRegistry.detect()` runs `detectInstalled()` for each adapter.
- Zero installed → current Claude-missing notification path.
- Exactly one installed → use it, no configuration required.
- Both installed → use the `spexr.agent.harness` preference (default `claude`),
  with a command **"SPEXR: Switch Agent Harness"** that flips the preference and
  relaunches.

### Preference namespace

Existing `spexr.claude.executable` / `spexr.claude.configDir` /
`spexr.claude.profileId` remain the Claude adapter's namespace, read only by
`ClaudeHarness`. New, parallel keys:

- `spexr.agent.harness`: `"claude" | "opencode"` — active harness selector.
- `spexr.opencode.executable`: optional explicit binary path.
- `spexr.opencode.configDir`: reserved (opencode account/config override) — unused
  until opencode exposes a per-account config the way Claude's `CLAUDE_CONFIG_DIR`
  does.

Existing users' folder-scoped settings are untouched. No value migration.

### opencode system-prompt injection

`OpencodeHarness.injectSystemPrompt` reuses the existing `buildLaunchContext`
(spec + expert + git prompt assembly) and writes the result to a project-local
agent file `.opencode/agent/spexr.md` (git-ignored), then launches with
`--agent spexr`. This is the closest structural analog to Claude's
`--append-system-prompt-file`: a per-launch file whose content is the SPEXR
context, selected by name. **Risk (validated in Slice 3):** confirm a
project-local agent file is picked up without a config reload/restart; fall back
to the config `instructions` array if not.

## Delivery slices

Each slice is an independently reviewable pull request with its own numbered
contract spec (`docs/specs/00NN-…`) and plan. Ordered by increasing risk; each
delivers standalone value.

**Slice 1 — Extract `HarnessAdapter` + `ClaudeHarness` (pure refactor).**
Introduce the interface; move existing Claude logic behind `ClaudeHarness` +
`HarnessRegistry` (single harness, auto-select). No observable behavior change.
Gate: the existing agent + Darkfactory test suites stay green. *First because it
de-risks everything downstream with no opencode variable in play.*

**Slice 2 — `OpencodeHarness`: Agent-terminal launch.**
`detectInstalled`, `resolveExecutable`, login-shell launch, opencode readiness
marker, dedicated terminal id. Adds `spexr.agent.harness` + auto-detect/default +
the "Switch Agent Harness" command. No spec injection yet. Delivers: launch
opencode as the Agent.

**Slice 3 — Spec/expert injection for opencode.**
`injectSystemPrompt` writes `.opencode/agent/spexr.md` and launches `--agent
spexr`, carrying experts + active-spec context onto opencode. Delivers: Agent-
terminal functional parity. Includes the agent-file-pickup validation.

**Slice 4 — Darkfactory: opencode tiles + resume.**
`processNames` includes `opencode`; session enumeration + `parseTranscript` from
`opencode export` JSON; resume via `--session <id>`. **Opens with a documented
spike** on global session enumeration (per-directory `session list` vs. deriving
project dirs from live processes vs. reading the database) before implementing.
Delivers: opencode sessions visible and resumable on the wall.
*Status: implemented on `feat/multi-harness-opencode` (2026-08-18, contract
`docs/specs/0013-harness-adapter-slice-4.md`) — not yet merged to main.*

**Slice 5 — Darkfactory: live-follow + AI summary for opencode.**
`followSession` via polling `opencode export` (or an opencode server stream —
`opencode serve` / Agent Client Protocol `acp` — if the Slice 4 spike shows
polling is inadequate) + summarize over the exported JSON. Delivers: full
Darkfactory parity.

**Slice 6 — opencode project-memory linking (optional, last).**
`linkProjectMemory` mapped onto opencode's `instructions[]` / `AGENTS.md` instead
of the `~/.claude` symlink. Least certain, isolable, deferred to the end.

Slices 1–3 complete the Agent terminal; 4–5 complete Darkfactory; 6 is polish.

## Slice 1 detail (this design's implementation-ready portion)

The remaining slices are sketched above and will be specified when reached. Slice
1 is defined enough to plan now.

**Scope:** introduce `HarnessAdapter`, `ClaudeHarness`, `HarnessRegistry`. Route
all existing Claude call sites through them. No opencode, no new preferences, no
UI change.

**Call sites to route (from exploration):**

| Current location | Moves behind |
|------------------|--------------|
| `browser/agent/claude-terminal-manager.ts` `resolveShell` / `buildShellArgs` | `buildLaunchShellLine` / `injectSystemPrompt` |
| `browser/agent/claude-readiness.ts` `isClaudeReady` | `isReady` |
| `CLAUDE_TERMINAL_ID = "spexr-claude"` | `terminalId()` |
| `node/claude-profile-detector.ts` `detectClaudeProfiles` / `resolveClaudeExecutableRobust` | `detectProfiles` / `resolveExecutable` |
| `node/darkfactory/process-scanner.ts` `parseClaudePids` (hardcodes `comm === "claude"`) | `processNames()` |
| `node/darkfactory/config-dirs.ts` + `scanDisk` | `listSessions` |
| `node/darkfactory/transcript-parser.ts` `parseTranscript` | `parseTranscript` |
| `node/darkfactory/resume-args.ts` `buildResumeArgs` (UUID) | `buildResumeArgs` |
| `browser/darkfactory/darkfactory-terminal-manager.ts` resume launch | `buildResumeArgs` + `buildLaunchShellLine` |
| `node/spexr-agent-backend-service.ts` `buildLaunchContext` | consumed by `injectSystemPrompt` |

**Behavior invariant:** `ClaudeHarness` returns exactly what the current code
computes. Slice 1 is a move, not a rewrite. Existing unit tests
(`process-scanner`, `resume-args`, `config-dirs`, `claude-profile-detector`,
`darkfactory-backend-service`) must pass unchanged; new tests cover only the
registry's detect/select logic.

## Risks

- **R1 — Global opencode session enumeration.** `opencode session list` is
  directory-scoped; Darkfactory needs all sessions across all projects.
  **Resolved (2026-08-17 spike, see
  `docs/superpowers/specs/2026-08-17-opencode-enumeration-spike.md`):** a single
  `opencode db --format json "SELECT id, directory, … FROM session"` CLI query
  enumerates every session globally (verified: 71 sessions / 7 dirs in one call),
  with the `directory` column as the tile group. `opencode db` is a first-class
  subcommand, so this stays CLI-only (SPEXR never opens the `.db` itself). The
  earlier candidates (per-dir `session list`, live-process derivation, raw DB
  read, `opencode serve`) are superseded.
- **R2 — Live-follow without a tail-able file.** opencode has no per-session
  JSON-lines file to `watch`. Slice 5 must poll `opencode export` or consume a
  server event stream; both are heavier than Claude's file tail.
- **R3 — Agent-file pickup.** `--agent <name>` requires the agent be registered;
  a project-local `.opencode/agent/*.md` may need a config reload. Validated in
  Slice 3; fallback is the config `instructions` array.
- **R4 — opencode accounts.** No confirmed `CLAUDE_CONFIG_DIR` analog, so
  `detectProfiles` returns default-only initially. If opencode later exposes a
  config-dir override, the seam already accommodates it.

## Testing strategy

- Slice 1: pure refactor — existing suites are the regression gate; add registry
  detect/select unit tests with injected `detectInstalled` seams.
- Slices 2–3: unit-test `buildLaunchShellLine`, `injectSystemPrompt` (file
  contents + args), `isReady` against captured opencode output; manual launch
  verification.
- Slices 4–5: unit-test opencode `parseTranscript` against captured `export`
  JSON fixtures and `buildResumeArgs` validation; the enumeration/follow
  transport is covered by the spike's chosen mechanism.
