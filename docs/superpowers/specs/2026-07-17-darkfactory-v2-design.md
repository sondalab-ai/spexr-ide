# Darkfactory v2 — agent monitoring wall

> **What is this file.** Design document (trade-offs, architecture, alternatives) for the **v2**
> reshape of the Darkfactory view in SPEXR. Audience: anyone building on SPEXR — the engineers
> implementing it, reviewers, and users who run SPEXR for their own projects. Owner:
> marcello.barile. Companion: **supersedes the list-view design in
> `2026-07-17-darkfactory-design.md`** (that v1 shipped a grouped list; this v2 replaces the
> presentation and interaction model while reusing v1's backend primitives). This design seeds a
> new implementation plan under `docs/superpowers/plans/`.

## Status legend

- **Shipped** — merged and available to users.
- **v1 shipped** — merged in the first Darkfactory pass (list view, per `2026-07-17-darkfactory-design.md`).
- **Planned** — described here, not yet implemented.

## Why v2 (feedback on v1)

The v1 grouped-list view shipped, but user testing surfaced four problems:

1. **It doesn't really show agents "in progress".** Confirmed by measurement: a running `claude`
   process does **not** hold its transcript (`.jsonl`) open — it appends and closes per write, so
   `lsof -c claude` never sees an open transcript, and the v1 "Live" badge (built on that) almost
   never fires. On this machine ~10 live `claude` processes were running with **zero** open
   transcripts detected.
2. **The list presentation is not appealing** and does not scale to watching many agents.
3. **Bare `normal` / `auto` labels** (session `mode` / `permission-mode`) are unreadable out of
   context.
4. **Expectation: follow and interact with each agent** with minimal context-switching — a live
   terminal-like surface per agent, not a passive list.

v2 reshapes Darkfactory into an **agent monitoring wall**: a grid of glanceable, semantic status
tiles with attention routing, and a focus mode that opens an interactive terminal (or a read-only
live follow) per agent.

## Liveness, reworked (fixes problem 1)

`lsof`-on-transcript is abandoned. New detection:

- **Running agents:** enumerate `claude` processes with `ps`; for each PID, resolve its working
  directory with `lsof -p <pid> -d cwd` (macOS/Linux) → the project directory.
- **Session state** combines the live-process set with transcript modified time:
  - **Working** — a live `claude` process runs in the session's project **and** the transcript was
    written within ~45s.
  - **Idle** — recent transcript, no live process in that project.
  - **Done / paused** — older, no live process.

**Honest limitation:** an exact PID → sessionId mapping is not possible (the process does not hold
the transcript open, and `ps`/cwd only identify the *project*). v2 maps liveness at **project
granularity** and attributes "working" to the project's most-recently-written transcript. Multiple
concurrent sessions in the same project are disambiguated by modified time only — documented, not
hidden. Degradation: `ps`/`lsof` unavailable → fall back to modified-time recency (as v1).

## Tile model — semantic status, not scrollback (fixes problems 2 and 3)

The core cognitive-load reducer: tiles do **not** render raw terminal scrollback. Each tile shows,
at a glance:

- **Project name** + a stable per-agent accent colour and glyph, so tiles are instantly
  distinguishable.
- **Status mode** with distinct visual treatment: Working · Needs-you · Idle · Done · Error.
- **Distilled action line** derived from the transcript: e.g. "Editing auth.ts", "Running tests",
  "Waiting: allow Bash?". One human-readable line, not a firehose. Derived heuristically from the
  last tool-use / assistant turn (zero-latency); the existing Qwen summary is an optional
  enrichment, not on the hot path.
- **Last-tool chip:** Edit / Bash / Read / … + target.
- **Heartbeat:** a small activity pulse from write cadence.
- **Relative time** since last activity.

Bare `mode` / `permission-mode` tokens are replaced (problem 3): permission-mode renders as an
icon + tooltip ("Auto-approve tools" / "Ask each time" / "Plan mode"); `mode` shows only when
non-default, with a readable label. No unlabelled tokens.

## Attention routing (the anti-cognitive-load mechanism)

- Tiles **auto-sort by attention priority:** Needs-you → Working → Idle → Done.
- **Needs-you** tiles get a loud border + a gentle transition animation (and an optional soft
  chime), and rise to the top — so the user never has to scan every tile to find the blocked one.
- Everything else stays **visually quiet**; motion fires only on state transitions ("calm by
  default, alert on change"). Respects `prefers-reduced-motion`.

### "Needs you" detection

- **Exact for SPEXR-embedded terminals.** For sessions opened *inside* SPEXR (we own the PTY), a
  pending permission / input prompt is detected directly.
- **Best-effort for external agents,** explicitly marked uncertain: a live process with no
  transcript write following a turn that ended in a permission-requiring tool-use is surfaced as
  "maybe waiting". The pending prompt lives in the other process's TTY, not the transcript, so this
  is a heuristic — rendered with an "uncertain" affordance, never as a hard claim.

## Focus mode — follow and interact (fixes problem 4)

Clicking a tile expands it to a large pane; the other tiles collapse to a compact rail (one "loud"
at a time).

- **Idle / paused session → interactive embedded terminal.** SPEXR spawns a terminal running
  `claude --resume <sessionId>` (or `-c`) in the project's directory. This **generalizes spec
  `0003-terminal-agent-surface`** (currently one terminal per workspace) to **N terminals keyed by
  session**, via a multi-terminal manager.
- **Session live elsewhere → read-only live follow.** SPEXR tails the transcript and renders the
  turns as they land (no PTY attach, no conflict), with a **"Fork & take over"** action
  (`--fork-session`) to branch into an interactive terminal when the user chooses.

## Architecture

Reuses v1 where possible; new units are small and independently testable.

**Backend (`theia-extensions/src/node/darkfactory/`):**
- `transcript-parser.ts` — **reused from v1**.
- `process-scanner.ts` — `ps` for `claude` processes + `lsof -p <pid> -d cwd` → live project set.
  Injectable command runner for tests. Replaces v1's `open-transcripts.ts` liveness role.
- `session-state.ts` — pure: combine live-project set + modified time → Working / Idle / Done.
- `action-distiller.ts` — pure: transcript entries → one distilled action line + last-tool chip.
- `transcript-tailer.ts` — watch one transcript, stream new turns to the frontend (read-only
  follow).
- `needs-you.ts` — pure heuristic for external best-effort; exact path lives with the embedded
  terminal manager.
- `spexr-darkfactory-backend-service.ts` — **reworked from v1**: orchestrates scan, state,
  distillation, tail subscriptions, and resume-terminal launches.
- multi-terminal launch: extend the existing agent-terminal path (spec 0003) to spawn a
  session-keyed `claude --resume` terminal.

**Protocol (`common/darkfactory-protocol.ts`)** — **extended from v1**: richer `AgentTile`
(state, action line, tool chip, accent id, needs-you + certainty, heartbeat), plus follow-stream
and open-terminal methods.

**Frontend (`browser/darkfactory/`):**
- `darkfactory-wall-widget.tsx` — the tile grid + attention routing + focus mode.
- `agent-tile.tsx` — one semantic tile.
- `focus-pane.tsx` — embedded terminal (resume) or read-only follow, per state.
- `darkfactory-format.ts` — **reused/extended from v1** (state labels, permission-mode labels,
  relative time, sort by attention).

## Security

- `ps` and `lsof` run via `execFile` (array args, no shell) — as v1.
- `claude --resume <sessionId>` spawns with the sessionId as an array arg; the sessionId is
  validated against the known-sessions set (from the last scan) before launch, and matched against
  a UUID shape — never interpolated into a shell.
- Read-only follow only reads transcripts under `~/.claude/projects`.

## Testing

Following the existing Vitest suite:
- Backend: `process-scanner` parsing with a faked `ps`/`lsof` runner; `session-state` combination
  table; `action-distiller` on transcript fixtures (tool-use → chip + line); `needs-you` heuristic;
  resume-launch argument construction + sessionId validation.
- Frontend: attention sort ordering; tile render per state; focus-mode selection of terminal vs
  follow; permission-mode label mapping.

## Scope (slices)

- **Slice 1 — Wall MVP.** Reworked liveness (process-scanner + session-state), semantic tiles
  (action line, tool chip, labels), attention sort. Replaces the v1 list. No focus mode yet.
- **Slice 2 — Focus + interact.** Focus mode; embedded `claude --resume` terminal for idle
  sessions (multi-terminal manager); read-only follow for live-elsewhere sessions.
- **Slice 3 — Needs-you routing.** Exact detection for embedded terminals; best-effort external
  heuristic with uncertainty affordance; chime + transition motion.

## Alternatives considered

- **Raw terminal wall (N live terminals tiled).** Rejected as the default: the scrollback firehose
  is the primary cognitive-load source. Raw terminals are available on demand in focus mode; the
  wall shows distilled semantic state.
- **Roster + single main terminal (IDE-like) / board of cards.** Rejected in favour of the wall +
  focus hybrid, which keeps many agents glanceable simultaneously (the user's explicit priority)
  while still allowing deep interaction with one.
- **Keep v1 list.** Rejected — does not scale to many agents and its liveness was non-functional.
