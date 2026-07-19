---
slug: 0011-darkfactory
title: Darkfactory — agent monitoring wall
status: shipped
createdAt: 2026-07-17
workflowStep: ship
updatedAt: 2026-07-19
---
> **What is this file.** Implementation contract for the Darkfactory view — a wall that monitors every local Claude Code session across all config dirs and lets the user resume or follow each one. Audience: SPEXR contributors. Owner: marcello.barile. This spec is the implementation contract; the trade-offs, alternatives, and v1→v2 history live in the companion design docs `docs/superpowers/specs/2026-07-17-darkfactory-design.md` (v1, grouped list) and `2026-07-17-darkfactory-v2-design.md` (v2, this wall). Where the v2 design and this spec disagree, this spec is authoritative — it records the shipped behavior, which evolved past the design during implementation (session state, model runtime, and the launch mechanism in particular).

## Goal

A running `claude` agent leaves no live handle on its transcript, so there is no built-in way to see, at a glance, every Claude session on the machine — which are working, which are waiting for the user, what each is doing — or to jump into one. Darkfactory is a tab that renders all local sessions as a grid of semantic status tiles with attention routing, an on-device AI summary per session, and a pinned focus card that embeds an interactive `claude --resume` terminal (or a read-only live follow) for a chosen session. No agent output leaves the machine.

## Non-goals

- No exact process→sessionId mapping. Liveness is resolved at **project granularity** (a live `claude` process is attributed to the project's newest transcript); concurrent sessions in one project are disambiguated by modified time only.
- No raw terminal scrollback on the tiles themselves — tiles show distilled semantic state; the terminal/follow lives only in the pinned card.
- No cross-account resume via a config-pinning shell alias — the account is owned per session by SPEXR (see AC-8). The removed `spexr.claude.launchCommand` preference is not reintroduced.
- No Windows liveness. `ps`/`lsof` process scanning is posix-only; Windows falls back to modified-time recency.

## Acceptance Criteria

- **AC-1 Discovery across config dirs.** The backend enumerates sessions from every discovered Claude config dir — the default `~/.claude`, any `~/.claude*` directory that contains a `projects/` subdir, and `CLAUDE_CONFIG_DIR` — not just one. Only the most-recently-active sessions are parsed each scan (bounded head+tail reads, capped count) so a large transcript history never stalls the backend event loop.
- **AC-2 Liveness.** `process-scanner.ts` lists `claude` processes with `ps -Ao pid,comm` and resolves each cwd with `lsof -a -p <pid> -d cwd -Fn`. The `-a` flag ANDs the pid and fd selectors; without it `lsof` ORs them and returns every process's cwd, so `parseCwd` reads a bogus `/` and no session matches its project. Args are built by `lsofCwdArgs(pid)` and covered by a regression test. Scan failure yields a `null` live set (never "working").
- **AC-3 Session state.** `classifySession` returns `{ state, needsYou, needsYouCertain }` from the live-process set and the session's last real transcript message (typed metadata records — `last-prompt`, `ai-title`, `mode`, `permission-mode`, `system` — and injected meta entries are skipped):
  - **working** — a live process owns the project's newest transcript and the turn is open: the last message is a user message (prompt or tool_result), an assistant `tool_use` for a non-permission tool, or a still-streaming assistant message (last block `thinking`). Not gated on write recency, so a long inference/tool does not flip to idle.
  - **needs-you** — a live session that awaits the human: the assistant ended its turn with a `text` reply (`needsYouCertain: false`), or a permission tool_use (`Bash`/`Edit`/`Write`/`WebFetch`) has stalled past ~2s (`needsYouCertain: true`) — unless the permission mode auto-approves (`auto`/`bypassPermissions`), in which case a pending tool_use is work.
  - A live session silent for more than ~10 min is **dormant**, not working (caps "working" so a leftover process cannot pulse forever).
  - Otherwise **idle** (recent, no live process) or **done** (old).
- **AC-4 Semantic tiles.** Each tile shows: project name + a stable per-project accent; status label (Working / Waiting / Needs you / Idle / Done / Failed) with distinct treatment; the session goal/prompt (sentence-cased, in a rounded translucent box, capped with a bottom fade when truncated, expandable); the git branch pinned to the card bottom. Bare `mode`/`permission-mode` tokens are never shown raw. Tiles auto-sort by attention: needs-you → working → idle → done, then most-recently-active.
- **AC-5 On-device AI summary.** For the top sessions, a local model produces a two-level summary: `Now:` (present activity) and `Overview:` (whole-session goal). The tile shows the **goal (overview) as the headline** and the **activity (now) as a muted sub-line** (falling back to `now` as the headline when there is no overview). Summaries are computed once, then refreshed for a **working** session only when it has meaningfully moved — a new user-turn count or a changed distilled action — throttled by a small floor, never on every transcript write. The old text stays visible during a refresh.
- **AC-6 Model runtime.** The summary model (`Qwen2.5-Coder-1.5B-Instruct` q4) runs in a **separate OS process** (`child_process.fork`), never a worker thread — in-process ONNX inference degraded the Electron backend↔frontend IPC into a permanent "offline". The worker is forked with a **real Node** binary when resolvable (onnxruntime-node segfaults under `ELECTRON_RUN_AS_NODE`), and loads the pipeline on the **WebGPU** execution provider with a CPU fallback (WebGPU ran ~4× faster than CPU on this hardware; CoreML was slower). The worker crash-respawns, disabling only after repeated back-to-back crashes.
- **AC-7 Pinned focus card.** Clicking a tile lifts that session into an expanded pinned card above the grid; the remaining tiles keep their order below. One session is pinned at a time; it auto-unpins (and stops its follow / disposes its terminal) when the session leaves the wall. A **resumable** session (idle, resolvable) opens an **interactive embedded terminal** in the card — a Theia `TerminalWidget` attached into the React-owned host via `UnsafeWidgetUtilities`, kept fitted with a `ResizeObserver`, detached on unmount (the manager owns disposal). A **live-elsewhere** session opens a **read-only live follow** with a **Fork & continue** action that opens a `--fork-session` terminal in the card.
- **AC-8 Resume account & cwd are authoritative.** `claude --resume <id>` resolves a conversation by `CLAUDE_CONFIG_DIR` **and** the cwd's project slug, so both must be correct. The resume runs in an interactive login shell (for the user's real PATH) but invokes the plain `claude` binary — never an account alias — with the session's `CLAUDE_CONFIG_DIR` exported (or `unset` for the default account) and a `cd` into the project inside the `-c` line, after the profile has run, so neither can be clobbered by the user's shell profile or a stray env var. The sessionId is validated against a UUID shape before launch.
- **AC-9 Read-only follow rendering.** The follow streams typed `FollowEvent`s (`prompt` / `assistant` / `tool` / `result` / `error`), rendered as distinct terminal-styled lines (accented prompts, command lines with the raw Bash command, dimmed output, red errors) so turns are easy to tell apart — not a single flat block. The buffer is bounded server- and client-side.

## Architecture

### Backend (`packages/theia-extensions/src/node/darkfactory/`)

| File | Role |
|------|------|
| `config-dirs.ts` | Discover every `~/.claude*` config dir with a `projects/` subdir, plus the default and `CLAUDE_CONFIG_DIR` |
| `process-scanner.ts` | `ps` + `lsof -a -p <pid> -d cwd` → live project set; `lsofCwdArgs(pid)` (AC-2) |
| `transcript-parser.ts` | Parse transcript header (cwd, goal, mode, permissionMode, interactive) |
| `session-state.ts` | Pure: `classifySession` + `isTurnOpen`/`lastTurn` → `{ state, needsYou, needsYouCertain }` (AC-3) |
| `action-distiller.ts` | Pure: transcript entries → distilled action line, tool chip, `describeToolUse` |
| `turns.ts` | `buildTurnsText` (model input) and `buildFollowEvents` (typed follow events, AC-9) |
| `spexr-darkfactory-backend-service.ts` | Orchestrates scan, state, summaries (cached), follow subscriptions |

### Model (`packages/theia-extensions/src/node/search/`)

| File | Role |
|------|------|
| `worker-description-generator.ts` | Forks the model worker with a real Node (AC-6); crash-respawn |
| `description-worker.ts` | Loads the pipeline on WebGPU (CPU fallback); one inference at a time |
| `description-format.ts` | Two-level summary prompt + `parseSessionSummary` |

### Frontend (`packages/theia-extensions/src/browser/darkfactory/`)

| File | Role |
|------|------|
| `darkfactory-wall-widget.tsx` | Tile grid + attention sort + pinned card + summary refresh queue |
| `agent-tile.tsx` | `AgentTileCard`, `AgentCondensedRow`, `AgentPinnedCard`, `TerminalMount`, `FollowTranscript` |
| `darkfactory-terminal-manager.ts` | `openEmbedded` — session-keyed resume/fork terminal, login-shell + authoritative account/cwd (AC-8) |
| `darkfactory-format.ts` | State labels, relative time, attention sort |

### Superseded during implementation

- **Session state.** The v2 design's "working = transcript written within ~45s" was replaced by the turn-open model with a ~10 min dormancy cap (AC-3): the 45s window flipped busy agents to idle during long tools/inferences.
- **Focus surface.** The design's separate `focus-pane.tsx` was replaced by the in-card `AgentPinnedCard` + `TerminalMount`; the standalone main-area follow pane was removed.
- **Launch mechanism.** The `spexr.claude.launchCommand` preference was removed. Per-project accounts are owned by the profile system (folder-scoped `spexr.claude.configDir`, detected from the user's aliases); the binary is resolved login-shell-aware (`resolveClaudeExecutableViaShell`) so a config-pinning alias can no longer break resume.

## Security

- `ps`/`lsof` run via `execFile` (array args, no shell).
- `claude --resume <sessionId>` validates the sessionId against a UUID shape before launch; it is passed as a quoted argument, never interpolated unquoted.
- Read-only follow only reads transcript files under discovered config dirs.

## Testing

Vitest, following the existing suite: `process-scanner` parsing + `lsofCwdArgs` with a faked runner; `session-state` combination table (turn-open, permission modes, dormancy, trailing metadata); `action-distiller` and `turns`/`buildFollowEvents` on transcript fixtures; `parseSessionSummary`; the worker generator's crash-respawn/disable resilience; backend `listTiles`/`summarize` with injected transcripts.
