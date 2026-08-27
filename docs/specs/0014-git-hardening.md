---
slug: 0014-git-hardening
title: Git hardening — reliable daily loop
status: planned
createdAt: 2026-08-27
workflowStep: plan
updatedAt: 2026-08-27
---
> **What is this file.** Implementation contract for hardening SPEXR's git
> integration so the everyday source-control loop is trustworthy. Audience:
> SPEXR contributors. Owner: marcello.barile. Companion files: the
> state-of-the-implementation assessment that motivated this work is published
> at https://claude.ai/code/artifact/f78fa07d-4d9b-43a1-b24d-abb53b6276ab; the
> step-by-step plan lives in
> `docs/superpowers/plans/2026-08-27-git-hardening.md`. This spec is
> authoritative where it disagrees with either.

## Goal

Make the see → stage → commit → push loop reliable. Today the SCM panel can
show a state the repository left minutes ago, a single file cannot be staged,
nothing can be discarded from the interface, and the first push of a new branch
fails. This spec closes those gaps and surfaces merge conflicts as something
distinct from ordinary edits.

The framing constraint is what SPEXR is: **agents run git inside its own
terminals.** A panel that only notices changes it made itself is wrong here in
a way it would not be in a conventional editor.

## Non-goals

- **No VS Code plugin host.** `@theia/git` is deprecated (last release 1.60.2,
  never published for the 1.71 line this project runs) and Eclipse points at
  the built-in VS Code git extension instead, which needs `@theia/plugin-ext`.
  Adopting it was considered and rejected: it would trade control over the
  agent-facing integration for a large new runtime surface. The custom
  `@theia/scm` implementation stays.
- **No merge conflict *resolution*.** Conflicts are surfaced and can be marked
  resolved; a three-way merge editor is out of scope. Resolution happens in the
  editor or the terminal.
- **No dirty-diff gutter decorations.** Deferred.
- **No history view.** `getLog` stays unused for now; see AC-14.
- **No stash, rebase, cherry-pick, amend, tags, remote management, submodules
  or worktrees.** The terminal is the intended surface for these, which is
  coherent in an IDE whose agents already work there.
- **No credential prompting.** Push and pull continue to rely on the user's
  configured git credential helper.

## Status vocabulary

| Term | Meaning |
|---|---|
| `Shipped` | merged to `main` and reachable by users |
| `Planned` | specified here, not yet implemented |
| `Deferred` | deliberately excluded, listed under Non-goals |

Everything in this spec is `Planned` until its slice merges.

## Acceptance Criteria

### Slice 1 — Backend foundations

- **AC-1 Serialized git access.** `SpexrGitBackendService` holds one
  `SimpleGit` instance per repository root in a private map, created with
  `maxConcurrentProcesses: 1`, exposed through a private `git(root)` accessor.
  Every one of the existing sixteen inline `simpleGit(root)` constructions is
  replaced by that accessor. Concurrent service calls against one root
  therefore run one at a time, via simple-git's own scheduler rather than a
  hand-written queue.

- **AC-2 Git directory resolved, not assumed.** The watched directory comes
  from `git rev-parse --git-dir` resolved against the root, never from
  concatenating `root` and `.git`. In a linked worktree `.git` is a file
  containing a `gitdir:` pointer, and assuming a directory there would leave
  the watcher silent.

- **AC-3 Repository watcher.** The backend watches, inside the resolved git
  directory: `HEAD`, `index`, `MERGE_HEAD`, `ORIG_HEAD`, and `refs/`
  recursively. Changes are debounced at 150 ms into a single notification. The
  watch call goes through an injected seam with the same shape darkfactory uses
  (`watchDir?: (dir, recursive, onChange) => FSWatcher`), so tests capture calls
  without touching the filesystem. A watch that cannot be established (missing
  path, permissions) is swallowed: the panel degrades to its current behavior
  rather than failing to start.

- **AC-4 Push channel.** `git-protocol.ts` exports
  `SpexrGitClient { onRepositoryChanged(): void }`. `SpexrGitService` gains
  `setClient(client: SpexrGitClient): void`. The backend module's binding for
  `GIT_SERVICE_PATH` switches from `new RpcConnectionHandler(path, () => service)`
  to the client-taking form already used for `SEARCH_SERVICE_PATH` and
  `DARKFACTORY_SERVICE_PATH`. Watchers are armed on the first `setClient` call
  and guarded against re-entry.

- **AC-5 Reactive refresh.** `SpexrGitScmProvider` implements
  `SpexrGitClient`; `onRepositoryChanged` calls `scheduleRefresh()`. The
  existing `fileService.onDidFilesChange` subscription is kept — it covers
  working-tree edits, which produce no git-directory activity.

  Concretely, after this slice: `git add` in an embedded terminal moves the
  file into "Staged Changes" without further user action, and a commit made by
  an agent empties the staged group.

- **AC-6 Single-flight refresh.** `refresh()` holds its in-flight promise and a
  rerun flag: a refresh requested while one is running does not start a second
  scan, it marks the current one dirty and re-runs once on completion. Required
  because two independent sources now trigger it.

### Slice 2 — Per-file staging

- **AC-7 Repository-relative paths.** Every path crossing the service boundary
  is relative to the repository root. `stageAll` and `unstageAll` currently
  pass absolute filesystem paths from `sourceUri.path.toString()`; they are
  converted along with the new per-file operations. This is a correctness fix,
  not only a tidy-up: absolute paths are not what `git add` and `git reset`
  expect and break on paths needing quoting.

- **AC-8 Discard.** `SpexrGitService` gains `discard(root, paths)`. The backend
  reads status once and splits the list: tracked paths go through
  `git checkout -- <paths>`, untracked paths are unlinked from disk. Callers
  pass a flat list and do not classify.

- **AC-9 Per-file commands.** `spexr.git.stageFile`, `spexr.git.unstageFile`
  and `spexr.git.discardFile` act on the selected SCM resource, registered both
  in the resource context menu and as inline row buttons. Multi-selection is
  honored where Theia's SCM tree provides it.

- **AC-10 Discard is confirmed.** `discardFile` opens a `ConfirmDialog` naming
  the affected files and stating the change cannot be undone. Cancelling
  performs no git call. There is no bypass preference.

### Slice 3 — Upstream-aware push and branch indicator

- **AC-11 Push sets upstream when needed.** The decision is made in the
  backend, from status, not by the caller: with no upstream configured the push
  runs `push --set-upstream <remote> <branch>`, otherwise a plain push. The
  remote is `origin` when present, else the sole configured remote; with
  several remotes and no `origin`, the call fails with a message naming the
  candidates rather than guessing. Creating a branch, committing, and pushing
  therefore succeeds end to end.

- **AC-12 `upstream` is populated.** `getBranches` fills the `upstream` field
  that `GitBranchDto` already declares, from the `branch -vv` output it already
  requests.

- **AC-13 Status bar indicator.** A status-bar entry shows the current branch
  with ahead/behind counts (`main ↑2↓1`), following the pattern of
  `description-job-status-bar-contribution.ts`. Clicking it opens the existing
  checkout quick pick. It reads the provider's last known status through a new
  `onDidChangeStatus` event — it must not spawn its own git process.

- **AC-14 Dead protocol surface removed.** `getDiff` is deleted from the
  protocol and the backend: it has no caller, and the diff editor goes through
  `getFileAtRevision` and the `git-original` resolver instead. `getLog` is
  kept, unused, as the seam a later history view will consume; this exception
  is deliberate and recorded here so the asymmetry does not read as an
  oversight.

### Slice 4 — Conflicts surfaced

- **AC-15 Untracked and unmerged stop sharing a letter.** `GitFileState` uses
  `"?"` for untracked and reserves `"U"` for unmerged. Today `"U"` is returned
  for untracked files while git's own unmerged `U` is folded into `"C"` by
  `mapStateChar` — two meanings on one letter, in opposite directions.

- **AC-16 Conflicts detected from real status pairs.** `mapFileChange`
  recognises `UU`, `AA`, `DD`, `AU`, `UA`, `DU` and `UD` as conflicts rather
  than collapsing any single `U` into `C`.

- **AC-17 Separate conflict group.** A third `ScmResourceGroup`, "Merge
  Conflicts", with `hideWhenEmpty = true`, ordered above staged and unstaged
  changes. A conflicted file appears there and nowhere else.

- **AC-18 Mark resolved.** `spexr.git.markResolved` stages the file, which is
  git's own definition of resolution. It is offered only on rows in the
  conflict group.

### Across all slices

- **AC-19 No regression.** `pnpm run typecheck`, `pnpm run lint` and the full
  `vitest run` for `packages/theia-extensions` pass at every slice boundary,
  and every pre-existing test passes unchanged. Note the root `pnpm test` is
  independently red on `main` for reasons tracked in
  https://github.com/sondalab-ai/spexr-ide/issues/13; that is the baseline, not
  a regression from this work.

## Architecture

New and modified modules:

| File | Change |
|------|--------|
| `common/git-protocol.ts` | + `SpexrGitClient`, `setClient`, `discard`; `GitFileState` gains `"?"` and narrows `"U"`; − `getDiff` (AC-4, AC-8, AC-14, AC-15) |
| `node/spexr-git-backend-service.ts` | per-root `SimpleGit` cache, `git(root)` accessor, git-dir resolution, watcher, `discard`, upstream-aware `push`, `upstream` in `getBranches` (AC-1 – AC-3, AC-8, AC-11, AC-12) |
| `node/spexr-backend-module.ts` | `GIT_SERVICE_PATH` binding takes a client (AC-4) |
| `browser/scm/git-scm-provider.ts` | implements `SpexrGitClient`, single-flight `refresh`, relative paths, conflict group, `onDidChangeStatus` (AC-5 – AC-7, AC-17) |
| `browser/scm/git-commands-contribution.ts` | per-file commands, discard confirmation, mark-resolved (AC-9, AC-10, AC-18) |
| `browser/scm/git-status-bar-contribution.ts` | **new** — branch and ahead/behind indicator (AC-13) |

Key seam decisions:

- **Watching is the backend's job.** The frontend has no filesystem access and
  the backend already holds the repository root. This also keeps the debounce
  next to the thing being debounced.
- **The watch call is injected, not imported.** Matching darkfactory's
  `watchDir` seam keeps watcher tests filesystem-free and fast.
- **Serialization comes from the library.** simple-git already schedules tasks
  per instance; the current code defeats it by constructing a new instance per
  call. Caching the instance is a smaller and less error-prone change than
  adding a queue.

## Testing strategy

- **Unit, filesystem-free.** Watcher arming and debounce through the injected
  seam. Status mapping for every conflict pair in AC-16, and the
  untracked/unmerged split in AC-15, are pure-function tests over
  `mapFileChange`.
- **Integration against real repositories.** `discard` (tracked versus
  untracked), upstream-aware push, and git-dir resolution in a linked worktree
  need real git state. The existing
  `packages/theia-extensions/src/node/spexr-git-backend-service.test.ts`
  establishes the local convention for temporary repositories; the first slice
  confirms it and follows it rather than introducing a second style.
- **Regression coverage.** Each slice's behavioral fix gets a test that fails
  before it: a stale-panel test for AC-5, a no-upstream push test for AC-11, an
  absolute-path test for AC-7.
