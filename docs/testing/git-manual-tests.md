# Git — manual acceptance tests

> **What is this file.** The manual half of the acceptance criteria for SPEXR's
> git integration: the checks that need a running application and cannot be
> asserted from a unit test. **Audience:** anyone verifying a change to the
> source-control panel, the git backend, or the agent's git context.
> **Owner:** repository maintainers.
> **Companion files:** [`docs/specs/0014-git-hardening.md`](../specs/0014-git-hardening.md)
> is the implementation contract and states what the behaviour should be; this
> file only says how to see it. Where the two disagree, the spec wins and this
> file is wrong.

## Scope

These cases cover spec 0014 and the follow-ups that changed its behaviour
afterwards:

| Reference                                                 | Title                                                    |
| --------------------------------------------------------- | -------------------------------------------------------- |
| [spec 0014](../specs/0014-git-hardening.md)               | Git hardening — the five slices                          |
| [#16](https://github.com/sondalab-ai/spexr-ide/issues/16) | Both resolutions on a delete/modify conflict             |
| [#17](https://github.com/sondalab-ai/spexr-ide/issues/17) | Watcher state is never cleared                           |
| [#18](https://github.com/sondalab-ai/spexr-ide/issues/18) | Agent git context does not distinguish conflicts         |
| [#20](https://github.com/sondalab-ai/spexr-ide/issues/20) | An open merge is reported independently of the file list |

The `Covers` column below uses the short `#N` form for these same issues.

Out of scope: the end-to-end Playwright suite, tracked separately in
[#14](https://github.com/sondalab-ai/spexr-ide/issues/14), which is
non-deterministic and cannot clear or implicate a change today.

## Setup

Build and start the application, then open a **scratch repository** as the
workspace — never this one. Several cases delete files and one deletes `.git`.

```bash
pnpm build:dev && pnpm start
```

Two of the cases need a conflicted repository. Both recipes below start from an
empty directory and end with the merge already conflicted.

```bash
# R1 — modify/delete conflict, reported by git as UD (deleted by them,
#      modified by us). The file is left in the working tree.
git init && git config user.email t@t.t && git config user.name T
echo base > f.txt && git add . && git commit -m base
B=$(git rev-parse --abbrev-ref HEAD)
git checkout -b theirs && git rm f.txt && git commit -m "they delete"
git checkout $B && echo ours > f.txt && git commit -am "we modify"
git merge theirs

# R2 — the mirror image, reported as DU (deleted by us, modified by them).
#      Accepting the deletion here stages nothing, because the deletion is
#      already in HEAD — this is the repository state that #20 is about.
git init && git config user.email t@t.t && git config user.name T
echo base > f.txt && git add . && git commit -m base
B=$(git rev-parse --abbrev-ref HEAD)
git checkout -b theirs && echo theirs > f.txt && git commit -am "they modify"
git checkout $B && git rm f.txt && git commit -m "we delete"
git merge theirs
```

A third recipe is needed once, for a both-modified conflict:

```bash
# R3 — both sides modify the same lines; git reports UU.
git init && git config user.email t@t.t && git config user.name T
printf 'one\n' > f.txt && git add . && git commit -m base
B=$(git rev-parse --abbrev-ref HEAD)
git checkout -b theirs && printf 'theirs\n' > f.txt && git commit -am "they modify"
git checkout $B && printf 'ours\n' > f.txt && git commit -am "we modify"
git merge theirs
```

## Cases

Run every command marked _from a terminal_ in an **embedded terminal inside the
application**, not an external one. The point of most of these cases is that the
panel notices a change it did not make itself.

Each case starts from the setup named in its own row, not from the state the
previous case left behind. T11 and T12 both resolve the R1 conflict in different
ways, so re-run the recipe between them.

### Everyday loop

| #   | Setup                                    | Action                                                                            | Expected                                                                                  | Covers    |
| --- | ---------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------- |
| T1  | Clean repository open                    | `echo x > a.txt` from a terminal                                                  | A row appears under **Changes** with the letter `U` (untracked), with no click on Refresh | spec 0014 |
| T2  | T1                                       | `git add a.txt` from a terminal                                                   | The row moves to **Staged Changes** with the letter `A`                                   | spec 0014 |
| T3  | T2                                       | `git commit -m x` from a terminal                                                 | Both groups empty themselves                                                              | spec 0014 |
| T4  | Application just started                 | Look at the status bar on the **first** paint                                     | `$(git-branch) <branch>` is already populated, not blank until the first refresh          | spec 0014 |
| T5  | One modified file and one untracked file | **Stage All** on the Changes group header, then **Unstage All** on Staged Changes | Everything moves to Staged, then all the way back                                         | spec 0014 |

### Discard

| #   | Setup                                                                        | Action                                     | Expected                                                                                                                    | Covers    |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------- |
| T6  | A tracked file, modified                                                     | **Discard** on its row                     | A confirmation dialog saying the change cannot be undone; on confirm the file returns to its staged content                 | spec 0014 |
| T7  | An untracked file                                                            | **Discard** on its row                     | The dialog says untracked files are deleted; on confirm the file is gone from disk                                          | spec 0014 |
| T8  | A file with a staged edit _and_ a further unstaged edit — two rows, one path | Open the row menu under **Staged Changes** | **Discard is absent.** It appears only on the Changes row, so it cannot destroy the unstaged edit the user did not click on | spec 0014 |

### Push

| #   | Setup                                                            | Action                    | Expected                                                                            | Covers    |
| --- | ---------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------- | --------- |
| T9  | A newly created branch with no upstream, and a remote configured | **Push** from the toolbar | The push succeeds and sets the upstream itself; the status bar loses its `↑` marker | spec 0014 |

### Conflicts

| #   | Setup | Action                                    | Expected                                                                                                                                 | Covers |
| --- | ----- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T10 | R1    | Look at the row under **Merge Conflicts** | Letter `!`; the row offers **Keep File** and **Accept Deletion**, and **not** Mark Resolved                                              | #16    |
| T11 | R1    | **Keep File**                             | The conflict is resolved, `f.txt` stays on disk, the row moves to Staged Changes                                                         | #16    |
| T12 | R1    | **Accept Deletion**                       | A confirmation dialog stating the content stays reachable in the merge — not "cannot be undone"; on confirm `f.txt` disappears from disk | #16    |
| T13 | R3    | Open the row menu                         | **Only Mark Resolved.** Neither of the two commands from T10 appears, because staging is the single outcome for a both-modified conflict | #16    |

### Merge state

| #   | Setup | Action                    | Expected                                                                                                                                                        | Covers |
| --- | ----- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| T14 | R2    | **Accept Deletion**       | The panel goes **completely empty** and the status bar reads `<branch> (merging)`. Without that marker the application would be claiming a clean tree mid-merge | #20    |
| T15 | T14   | **Commit** from the panel | `(merging)` disappears; `git log` shows the merge commit                                                                                                        | #20    |

### Recovery and agent context

| #   | Setup                   | Action                                                             | Expected                                                                                            | Covers |
| --- | ----------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------ |
| T16 | Repository open         | `rm -rf .git` from a terminal, then `git init`, then edit any file | The panel empties and then **works again**. Before #17 it stayed frozen for the rest of the session | #17    |
| T17 | R1, conflict still open | Ask an agent what state the repository is in                       | It reports a merge in progress and the conflicted file — not "1 modified file"                      | #18    |

## What these cases are load-bearing for

Most of the behaviour above is also covered by the automated suite. Three cases
are not, and are the reason this file exists.

**T10 and T13 — command visibility.** The predicates that decide which commands
a conflict row offers are unit-tested against hand-built row objects, not
through Theia's `ActionMenuNode` argument spreading. The spreading behaviour is
the same one Discard has relied on since spec 0014, so the risk is low, but no
test exercises the real path.

**T4 — the first paint.** The status bar renders from whichever arrives first,
the provider's cached status or the change event. Contribution start order is
not a contract, so only a real launch shows whether the fallback works.

**T16 — the deterministic half only.** This case deletes `.git` and lets a
refresh observe it missing before recreating it. The other half — deleted and
recreated with no refresh in between — is detected by comparing the git
directory's inode, which some filesystems defeat by reusing inode numbers. That
limitation is recorded on `dirIdentity` in
`packages/theia-extensions/src/node/spexr-git-backend-service.ts`; it is not a
case you can fail reliably.
