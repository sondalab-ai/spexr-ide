# Darkfactory — cross-project agent overview

> **What is this file.** Design document (trade-offs, architecture, alternatives) for the
> Darkfactory view in SPEXR. Audience: anyone building on SPEXR — the engineers implementing the
> view, reviewers, and users who run SPEXR for their own projects.
> Owner: marcello.barile. Companion: this design seeds a formal implementation spec under
> `docs/specs/` and an implementation plan under `docs/superpowers/plans/`; the spec is the
> implementation contract, this document covers the reasoning behind it.

## Problem

Working across many concurrent Claude Code sessions in separate terminal tabs / windows is hard to
track: which project each session belongs to, where it runs, and what it is currently doing. SPEXR
today hosts exactly one `claude` session per workspace (spec `0003-terminal-agent-surface`,
non-goal: "one session per workspace"), so no single surface answers "what are all my agents doing
right now".

Darkfactory is a machine-wide, read-only overview of every Claude Code session: where it runs
(project / folder), whether it is live, and a short summary of what it is doing.

## Status legend

- **Shipped** — merged to the SPEXR codebase and available to users.
- **PoC implemented (not delivered)** — prototype exists, not merged.
- **Planned** — described here, not yet implemented.

Everything in this document is **Planned** unless stated otherwise.

## Data source

Claude Code writes one JSON Lines (`.jsonl`) transcript per session under
`~/.claude/projects/<slug>/<sessionId>.jsonl`. One file corresponds to one top-level session — i.e.
one "agent". Subagents (Task tool) are recorded inline as sidechain entries
(`isSidechain: true`) within the same file, so they do not create separate agents, matching the
"one chat = one agent" mental model.

Per file the service extracts:

- `sessionId` (also the filename stem)
- `cwd` — the **real** absolute project path, read from transcript entries. Preferred over decoding
  the directory slug, because a slug replaces path separators with `-` and cannot be reversed
  unambiguously when folder names themselves contain `-`.
- git branch (from transcript metadata when present)
- last-modified time (file `mtime`)
- turn count
- last user prompt (truncated)
- last tool / action
- `mode` and `permission-mode`

Non-parseable lines are skipped rather than failing the whole file, following the existing
`skip non-parseable files` precedent in the spec list.

## Architecture

Three units, each independently testable, following existing SPEXR conventions
(`common/*-protocol.ts` remote-procedure-call interface → `node/*-backend-service.ts` implementation
bound in `spexr-backend-module.ts` → `browser/views/*` React widget registered in
`spexr-frontend-module.ts`).

### 1. Backend service — `SpexrDarkfactoryBackendService`

- Contract in `common/darkfactory-protocol.ts`, service path `/services/spexr-darkfactory`.
- `listAgents(): AgentSession[]` — scan `~/.claude/projects`, parse each transcript into an
  `AgentSession`.
- **Liveness.** A running `claude` process holds its transcript open for writing. The service maps
  open transcripts to process ids via `lsof`, producing three states:
  - **live** — transcript currently open by a `claude` process.
  - **idle** — modified within the last N hours, not open.
  - **archived** — older; hidden behind a toggle, excluded from the default list.

  `lsof` is bounded by a timeout; if `lsof` is unavailable or times out, the service degrades to
  modified-time recency alone (live state unavailable, idle/archived still computed). This mirrors
  the graceful-degradation pattern already used across SPEXR (missing model, missing executable).
- **Push updates.** `fs.watch` on the projects directory emits `onAgentsChanged` on transcript
  writes. A separate liveness poll (~4s) refreshes process state, because starting or stopping a
  process does not touch the transcript.
- `summarize(sessionId): string` — build a prompt from the last N turns and generate a one-line
  English activity summary via the **existing local model worker** (`worker-description-generator`
  pattern, Qwen model). A new worker request kind `summary` reuses the already-loaded model — the
  model is not loaded a second time. Results are cached by `sessionId + mtime` and debounced; the
  cache invalidates when the transcript changes. If the model is unavailable, the summary degrades
  to a heuristic (truncated last user prompt).

### 2. Protocol — `common/darkfactory-protocol.ts`

`AgentSession` shape (project path, session id, branch, state, last-activity timestamp, turn count,
mode, permission-mode, heuristic last-prompt) plus the service interface and the `onAgentsChanged`
event. Summaries are fetched separately (async, cached) so the list renders immediately.

### 3. Frontend — `SpexrDarkfactoryWidget`

- React widget, registered as a **pinnable tab with arbitrary position**, exactly like the existing
  Welcome / Specs / Agent tabs. A command opens it.
- Cards **grouped by project folder** (multiple sessions per project cluster together). Order: live
  first, then modified-time descending.
- Card content: project name + path (monospace), git branch, status badge (pulsing live light /
  idle), relative "last activity", AI summary line (skeleton → filled asynchronously), `mode` /
  `permission-mode` chip.
- Card actions:
  - **Open in SPEXR** — open the folder as a workspace, reusing the existing multi-window
    infrastructure (a new SPEXR window with its own agent).
  - **Reveal in Finder** — show the folder in the OS file manager.
  - **Copy path** — copy the project or transcript path.

### Aesthetic

Editorial "factory floor" dark treatment matching the Darkfactory name: a custom CSS-property
palette, the purple status light reused from smart-search, monospace paths, and a non-generic
layout (not a plain centered card grid).

## Error handling

- Missing `~/.claude/projects` → empty state.
- Corrupt transcript line → skip that line.
- `lsof` / `ps` unavailable or slow → modified-time fallback (no live state).
- Model unavailable → heuristic summary.

## Testing

Following the existing Jest suite:

- Backend: transcript → `AgentSession` parsing (fixtures), liveness merge with a faked
  `lsof` / process list, `cwd` resolution, summary cache invalidation on modified-time change,
  modified-time fallback path.
- Frontend: card render states (live / idle / summary-loading), grouping and ordering.

## Scope

- **Minimum viable product.** List + status + summary + Open-in-SPEXR / Reveal / Copy-path.
- **Later.** Expand a card to show recent turns, filters, search across agents.

## Alternatives considered

- **Only SPEXR-launched sessions.** Rejected: SPEXR is one workspace per window, so a cross-window
  view would need a shared registry across Electron processes — more complex and less complete than
  reading the machine-wide transcripts.
- **Only live processes (no history).** Rejected: loses paused sessions the user wants to return to.
- **Heuristic-only summary.** Rejected in favor of the local model for readability; the heuristic
  is retained as the fallback.
