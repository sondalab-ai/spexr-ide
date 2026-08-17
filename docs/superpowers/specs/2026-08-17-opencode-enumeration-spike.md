# opencode session enumeration — Risk R1 spike

> **What is this file.** Findings of the Darkfactory-slice spike that the
> multi-harness design (`docs/superpowers/specs/2026-08-17-multi-harness-opencode-design.md`,
> Risk R1) deferred: how to enumerate opencode sessions **globally** (across all
> projects) for the Darkfactory wall, at parity with Claude's walk of
> `~/.claude*/projects/`. Audience: SPEXR contributors planning Slice 4. Owner:
> marcello.barile. Companion: the design (trade-offs/slices) and the forthcoming
> Slice 4 contract spec (`docs/specs/00NN-…`). This spike is empirical — every
> claim was run against the installed binary (opencode 1.18.13,
> `/opt/homebrew/bin/opencode`) on 2026-08-17, not recalled.

## The question

Claude's Darkfactory enumerates **all** sessions globally by walking
`~/.claude*/projects/*.jsonl`. opencode stores sessions in one SQLite database
(`~/.local/share/opencode/opencode.db`), and its `opencode session list` is
**directory-scoped** — it returns only the current working directory's sessions,
with no global flag. The design left three candidate strategies open:
per-directory `session list`, deriving project dirs from live processes, or
reading the database. This spike picks one.

## Decision

**Enumerate globally with a single `opencode db` CLI query against the `session`
table.** This is a first-class opencode subcommand (`opencode db [query]`,
`opencode db path`), so it satisfies the design's non-goal "read sessions only
through opencode's CLI, never by opening the SQLite file directly" — opencode
runs the query; SPEXR never opens the `.db` with its own driver.

```
opencode db --format json "SELECT id, directory, parent_id, title, agent, model, time_created, time_updated FROM session ORDER BY time_updated DESC"
```

Verified on this machine: **one call returned 71 sessions across 7 distinct
directories**, each row carrying the session `directory` (its working directory)
— exactly the grouping key the Darkfactory tiles need. The competing
`opencode session list` returned only the current directory's sessions.

### Why this beats the three sketched options

| Option | Global? | Calls | Verdict |
|--------|---------|-------|---------|
| `opencode db` SELECT on `session` (**chosen**) | yes | 1 | Global, cheap, rich, CLI-only |
| `session list` per directory | no | N (one per known dir) | Needs a directory list we don't have; misses unknown dirs |
| Derive dirs from live processes | live only | N | Misses idle/historical sessions — fails parity |
| Open the `.db` file directly | yes | — | **Excluded by design non-goal** |

## Data model (verified)

**`session` table columns** (relevant subset): `id` (text PK, opaque —
e.g. `ses_ff05399bfffee5y4lPy5RRLTsz`, prefix `ses_`, **not** a UUID),
`project_id`, `directory` (working directory), `parent_id` (fork lineage),
`title`, `agent`, `model` (JSON blob), `time_created`, `time_updated` (epoch ms).

**Resume-id validation:** ids are opaque, so `OpencodeHarness.isResumableId` must
be an explicit whitelist, e.g. `/^ses_[A-Za-z0-9]+$/` — **never** "non-empty
string." The id reaches a shell command line, so its regex is also the
sanitizer.

**Transcript source (Slice 4 `parseTranscript`):** `opencode export <id>`
returns `{ info: {...}, messages: [ { info: { role: "user"|"assistant", time,
agent, model, ... }, parts: [ { type, text?, ... } ] } ] }`. Part `type` ∈
{`text`, `tool`, `patch`, `step-start`, `step-finish`}; visible conversation
text lives in `text` parts. A 30-message session exported to 216 KB of JSON,
parsed cleanly. (Capture the full stdout before parsing — piping through
`head` truncates mid-JSON.)

**Resume flags (verified in `opencode --help`):** `-s/--session <id>` resumes a
specific session; `--fork` forks it (note: Claude uses `--fork-session` — the
flags are **not** symmetric); `--continue` resumes the last session.

## Residual risk & mitigations

- **Schema coupling.** `opencode db` exposes opencode's internal table layout; a
  future opencode release could rename `session` columns. *Mitigation:* select
  only the minimal column set above; treat a failed/empty `opencode db` result
  as "enumeration unavailable" and fall back to the existing modified-time-only
  liveness path (same backstop Claude uses when process scanning fails). Record
  the opencode version the schema was verified against (1.18.13).
- **`opencode db` availability.** It is a documented subcommand today; if a
  build ships without it, `resolveActiveHarness`/darkfactory degrade to the
  fallback above rather than erroring.
- **Query safety.** The SELECT string is hardcoded — no SPEXR/user input is
  interpolated into it — so there is no SQL-injection surface.

## What this unblocks

Slice 4 can now specify `OpencodeHarness.listSessions()` as the `opencode db`
query above (mapped to the existing `SessionRef` shape with `directory` as the
tile group) and `parseTranscript()` over `opencode export` JSON, with resume via
`--session <id>` [`--fork`]. Live-follow + AI summary remain Slice 5.
