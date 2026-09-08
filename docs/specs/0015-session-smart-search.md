---
slug: 0015-session-smart-search
title: Session smart search — natural-language recall of past sessions
status: draft
createdAt: 2026-09-08
workflowStep: specify
updatedAt: 2026-09-08
---

> **What is this file.** Implementation contract for natural-language search over
> every agent session Darkfactory knows about, surfaced as a query bar on the
> wall. Audience: SPEXR contributors. Owner: marcello.barile. Companion files:
> `docs/specs/0011-darkfactory.md` defines the wall this feature extends, and
> `docs/specs/0012-harness-adapter-slice-1.md` defines the harness enumeration it
> reuses. This spec is authoritative where it disagrees with either. Trade-offs
> and rejected alternatives are recorded under "Design decisions" below rather
> than in a separate design doc.

## Goal

Let the user find a past session by describing it, not by remembering when it
ran. A query like "the session where we were adding new effects to the spexr
design system" must return that session even when it is months old and far
outside the sixty most recent the wall renders.

The wall today is a recency surface: `RECENT_LIMIT = 60` caps how many sessions
are parsed per scan, and the machine holds roughly a thousand transcripts across
two Claude config directories plus opencode's database. Everything older is
unreachable from the interface.

## Non-goals

- **No new embedding model.** The vendored encoder (`Xenova/all-MiniLM-L6-v2`)
  stays. See "Design decisions" for why a multilingual encoder was rejected.
- **No per-turn retrieval.** One document per session; a query cannot locate a
  specific command buried mid-session except through its literal terms.
- **No date or project parsing from the query.** "last week", "in spexr" are
  scored as ordinary terms, not turned into filters. Deferred.
- **No cloud inference.** Indexing and querying run entirely on the machine.
- **No change to how sessions are enumerated, classified, or rendered.** The
  feature reads the existing harness adapters and reuses `AgentTile`.
- **No search over trashed sessions.** Trash is a frontend concept
  (`browser/darkfactory/trash.ts`); hits are filtered through it client-side.
- **No AI summary on a result card.** The wall queues its two-line summaries for
  a handful of top sessions, each a roughly 13-second local inference; queueing
  them for a result set would stall behind the wall's own queue. A hit renders
  its goal and action line, plus a summary only if one is already cached for
  that session. Revisit once summaries are cheaper or persisted.

## Status vocabulary

| Term       | Meaning                                       |
| ---------- | --------------------------------------------- |
| `Shipped`  | merged to `main` and reachable by users       |
| `Planned`  | specified here, not yet implemented           |
| `Deferred` | deliberately excluded, listed under Non-goals |

Everything in this spec is `Planned` until its slice merges.

## Design decisions

**Hybrid lexical + dense scoring, no second model.** Lexical scoring here means
BM25 (Best Match 25), the ranking function the code search already uses; dense
scoring means cosine similarity between sentence embeddings. The vendored encoder is
English-only, while session goals on this machine are largely Italian. Adding a
multilingual encoder (`multilingual-e5-small`, roughly 120 MB vendored plus a
second ONNX runtime resident in the backend) was considered and rejected: the
BM25 half of a hybrid score already covers literal Italian terms and proper
nouns ("effetti", "design system", "spexr"), and the dense half covers English
paraphrase. This mirrors `node/search/spexr-search-backend-service.ts`, which
scores code the same way.

**A separate, globally-located index.** Sessions span every project and both
config directories, so the code index's per-workspace `<root>/.spexr/` location
does not apply. The session index also gets its own version constant: reusing
the code index's `INDEX_VERSION` (currently 8) would force a full code reindex
for every user on any session-index change.

**Embedding runs in the backend process.** The forked child process in
`node/search/description-worker.ts` exists for the 1.5B generation model, whose
native inference starved the Electron backend socket. The 384-dimension encoder
already runs in-process for the code index (`EmbedderToken`, bound in
`spexr-backend-module.ts`), and this feature keeps that arrangement.

## Acceptance Criteria

### Slice 1 — Session index

- **AC-1 Session document.** `node/darkfactory/session-doc.ts` exports
  `buildSessionDoc(input: SessionDocInput): string`, a pure function producing
  the indexable text of one session from: project name, the last two segments of
  the project path, git branch, the session goal, the most
  recent assistant prose segments (via `recentAssistantProse`), and the distinct
  tool targets seen in the transcript (file paths, command names). The result is
  capped at 4000 characters with the goal first, so a document that hits the
  cap loses tool targets rather than the sentence that identifies the session.
- **AC-2 Index record.** `node/darkfactory/session-index.ts` exports
  `SESSION_INDEX_VERSION = 1` and a `SessionIndex` class holding one
  `SessionRecord` per session — `sessionId`, `harness`, `projectPath`,
  `projectName`, `transcriptPath`, `configDir`, `mtimeMs`, `docHash`, `vector`,
  `goal`, `doc` — alongside a `BM25Index` instance from
  `node/search/bm25-index.ts`, keyed by `sessionId` in place of a file path.
  `upsert` writes both stores; `remove` clears both.
- **AC-3 Persistence.** `node/darkfactory/session-index-store.ts` resolves the
  index path to `~/.spexr/sessions-index.json`, overridable with
  `SPEXR_SESSION_INDEX` so tests never touch the real home directory. Writes go
  to a temporary file in the same directory and are renamed into place. A file
  whose `version` differs from `SESSION_INDEX_VERSION`, or which fails to parse,
  loads as an empty index rather than throwing.
- **AC-1b Goal recovery.** The goal comes from `sessionGoal`, falling back to the
  parsed transcript's own goal and last prompt. When all three are empty — a long
  injected preamble (a project's CLAUDE.md, system reminders, hook output) can
  exhaust the wall's 32 KB head read before the human's first sentence appears —
  `node/darkfactory/session-goal.ts` reads 256 KB of the transcript head and
  returns the first genuine prompt. Measured on this machine, that is the
  difference between a third of sessions indexing with no goal and none of them.

- **AC-4 Incremental crawl.** `node/darkfactory/session-indexer.ts` enumerates
  sessions through the installed harness adapters — the same `listSessions()`
  the wall uses, which is already global — and skips any session whose
  `sessionId` is present with an unchanged `mtimeMs`. Claude transcripts are
  read with `readBoundedLines` (head 32 KB + tail 96 KB, the same bound the wall
  uses); opencode sessions are loaded through the adapter's `loadEntries()`.
- **AC-5 Bounded cost.** The crawl embeds in batches of 16 documents, parses at
  most 8 transcripts at a time (the value the wall scan uses as
  `PARSE_CONCURRENCY`), and awaits between batches so
  the backend event loop is never held. It starts 10 seconds after the backend
  comes up, not during startup, and persists the index at most once every 5
  seconds while running.
- **AC-6 Removal.** A session present in the index but absent from enumeration
  is dropped from both stores on the next full crawl, so deleted transcripts stop
  appearing in results.

### Slice 2 — Query and open

- **AC-7 Service method.** `SpexrDarkfactoryService` gains
  `searchSessions(query: string): Promise<SessionHit[]>`, where
  `SessionHit = { tile: AgentTile; score: number; archived: boolean }`. An empty
  or whitespace-only query returns `[]`. `archived` is true when the hit was not
  part of the current scan.
- **AC-8 Hybrid scoring.** The query is expanded with `expandQuery` and embedded
  once. Dense candidates are taken at `TOP_K * 3` with a 0.05 floor; BM25 scores
  are normalized by the maximum and any document scoring at least 0.3 of that
  maximum joins the candidate set. The final score is
  `0.65 * cosine + 0.35 * normalizedBm25`, results below 0.18 are dropped, and
  the remainder is sorted descending and capped at 24 hits. These are the
  weights and thresholds `spexr-search-backend-service.ts` already uses.
- **AC-9 Hits are renderable.** Each hit carries a full `AgentTile`. For a
  session in the current scan the wall's own tile is returned unchanged. For an
  archived session the transcript is parsed on demand — only for the hits, never
  for the whole index — and run through the same distillation the wall uses
  (`classifySession`, `distillAction`, `recentActions`), so the card looks
  native.
- **AC-10 Hits are openable.** `summarize`, `planFocus` and `startFollow`
  resolve from a `searchMeta` map when `index` has no entry for the session.
  `listTiles` clears `index` on every scan, so a hit registered there would stop
  opening within one poll interval; `searchMeta` is owned by the search path and
  survives scans. Entries are evicted when their session re-enters `index` or
  when a new query replaces them.
- **AC-11 Archived sessions never resume blindly.** An archived hit resolves
  through the existing `planFocus` rules: a session whose config directory the
  launch command cannot resume against, or whose state is `working`, opens
  read-only. No new resume path is introduced.
- **AC-12 Progress push.** `SpexrDarkfactoryClient` gains
  `onSessionIndexProgress(done: number, total: number): void`, emitted at most
  once per batch while the crawl runs and once with `done === total` when it
  finishes.

### Slice 3 — Wall query bar

- **AC-13 Query bar.** A `spexr-df-search` row renders under `NewSessionLauncher`
  with a text input, a spinner while a query is in flight, the hit count, and —
  while the index is incomplete — the indexing progress from AC-12. `Escape`
  and an empty input both clear the query.
- **AC-14 Debounce and cancellation.** `browser/darkfactory/session-search.ts`
  holds the pure query state: input is debounced at 250 ms, a query superseded
  before its result arrives is discarded rather than rendered, and clearing
  restores the unfiltered wall without a round trip.
- **AC-15 Running sessions are never unmounted.** With a query active, only the
  grid and its project groups are replaced by the ranked hit list. `launched`
  and `pinned` cards keep rendering from the same array positions inside the
  `spexr-df-active` host, so no `TerminalMount` unmounts and no live session is
  detached. A session that is both pinned and a hit renders once, as its pinned
  card.
- **AC-16 Ranked flat list.** Search results render as one flat list ordered by
  score, without project group headers, since grouping by project carries no
  meaning across a ranked result set. An archived hit carries a visible marker
  distinguishing it from a session in the current scan.
- **AC-17 Empty and partial states.** A query with no hits renders an explicit
  empty state that names the query and, when indexing is incomplete, says so. A
  query issued before any indexing has happened returns `[]` and the bar shows
  the progress hint rather than an empty result.
- **AC-18 Trash is respected.** Hits whose session is in the local trash are
  filtered out client-side, using the existing `trash.ts` predicate.

## Architecture

### Backend (`packages/theia-extensions/src/node/darkfactory/`)

| File                                   | Role                                                             |
| -------------------------------------- | ---------------------------------------------------------------- |
| `session-doc.ts`                       | Pure document builder (AC-1). No Node imports.                   |
| `session-index.ts`                     | `SessionIndex`, `SessionRecord`, `SESSION_INDEX_VERSION` (AC-2). |
| `session-index-store.ts`               | Path resolution and atomic JSON load/save (AC-3).                |
| `session-indexer.ts`                   | Incremental crawl, batching, progress callback (AC-4 to AC-6).   |
| `spexr-darkfactory-backend-service.ts` | `searchSessions`, `searchMeta`, progress push (AC-7 to AC-12).   |

Reused unchanged from `node/search/`: `bm25-index.ts` (`BM25Index`,
`bm25Tokenize`), `query-expander.ts` (`expandQuery`), `vector-math.ts`
(`cosineSimilarity`, `topKIndices`), and `embedding-model.ts` via
`EmbedderToken`. Reused from `node/darkfactory/`: `bounded-read.ts`, `turns.ts`,
`action-distiller.ts`, `session-state.ts`.

### Common (`packages/theia-extensions/src/common/`)

`darkfactory-protocol.ts` gains `SessionHit`, the `searchSessions` method on
`SpexrDarkfactoryService`, and `onSessionIndexProgress` on
`SpexrDarkfactoryClient`.

### Frontend (`packages/theia-extensions/src/browser/darkfactory/`)

| File                          | Role                                                                  |
| ----------------------------- | --------------------------------------------------------------------- |
| `session-search.ts`           | Pure query state: debounce, supersede, clear (AC-14).                 |
| `darkfactory-wall-widget.tsx` | Query bar, hit rendering, mount preservation (AC-13, AC-15 to AC-18). |

### Index size

Roughly a thousand sessions at a 384-dimension vector serialized as JSON numbers
(about 4.6 KB) plus the capped document (up to 4 KB) puts the index near 8 MB on
disk and a comparable footprint in memory. That is the same order as the code
index for a mid-sized workspace and needs no compaction in this version.

## Security

- **No new network surface.** Indexing and querying are local; the encoder runs
  offline (`env.allowRemoteModels = false`).
- **The index holds transcript excerpts** — goals, assistant prose, file paths —
  in `~/.spexr/sessions-index.json`, which is neither a workspace file nor
  reachable by a project's agents. It is written with default permissions, the
  same as the transcripts it derives from.
- **No query interpolation into a shell.** opencode enumeration keeps using the
  hardcoded `SESSION_QUERY`; the user's query never reaches a spawned process.
- **Path handling is unchanged.** Transcript paths come from harness enumeration,
  not from the query, so no traversal surface is added.

## Testing

| Test                                        | Covers                                                                                                                                                                                      |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `session-doc.test.ts`                       | Composition order, 4000-character cap, target dedupe, empty inputs (AC-1).                                                                                                                  |
| `session-index.test.ts`                     | Upsert/remove across both stores, round-trip persistence, version mismatch and corrupt file both yielding an empty index (AC-2, AC-3).                                                      |
| `session-indexer.test.ts`                   | Unchanged sessions skipped by `mtimeMs`, batching, removal of vanished sessions, progress callback (AC-4 to AC-6).                                                                          |
| `spexr-darkfactory-backend-service.test.ts` | Hybrid ranking with a fake embedder, empty-query short circuit, an archived hit outside `RECENT_LIMIT` being openable through `planFocus` after a scan has cleared `index` (AC-7 to AC-11). |
| `session-search.test.ts`                    | Debounce, superseded query discarded, clear restores the unfiltered wall (AC-14).                                                                                                           |

The archived-hit test is the regression guard for the failure this design exists
to avoid: a result that ranks correctly and then cannot be opened.
