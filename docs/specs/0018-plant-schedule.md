---
slug: 0018-plant-schedule
title: Plant schedule — run a graph of agent sessions from the Dark Factory
status: draft
createdAt: 2026-09-27
workflowStep: spec
forcedSteps: []
updatedAt: 2026-09-28
---
> **What is this file.** Implementation contract for the "plant schedule": a
> sidebar in the Dark Factory where the operator lays out a set of agent
> sessions, says which waits for which, and runs them, each one optionally
> looping until it declares itself done. Audience: SPEXR contributors and
> reviewers. Owner: marcello.barile. Builds on `docs/specs/0011-darkfactory.md`
> (the wall, session liveness, launch rules) and on the harness abstraction of
> `docs/specs/0012-harness-adapter-slice-1.md` and
> `docs/specs/0013-harness-adapter-slice-4.md`. The implementation plan will be
> a separate file under `docs/superpowers/plans/`.

## Goal

The Dark Factory shows agent sessions and starts them one at a time, by hand.
Work that spans several sessions — "refactor the API, then update the two
clients in parallel, then run the end-to-end fixes until they pass" — still
needs the operator to watch each session, notice it has finished, and start the
next with a prompt that repeats what the last one did.

The plant schedule takes that over. The operator describes the work once as a
set of **tasks** (one agent session each: project, harness, account, prompt)
and the order between them. The schedule starts every task as soon as the tasks
it waits for are done, runs independent tasks side by side, and re-prompts a
task until it says it has converged. Every task is an ordinary live card on the
wall: the operator can watch any of them and take over at any point.

## Glossary

- **Task.** One agent session the schedule starts and watches, with its own
  project folder, harness, account, prompt and optional loop.
- **Schedule.** A named set of tasks plus the "waits for" links between them.
- **Run.** One execution of a schedule, from the operator pressing Run until
  every task has converged or been skipped, or the operator aborts.
- **Dependency graph.** The tasks and their "waits for" links. It must have no
  cycles (a directed acyclic graph). Two tasks with no path between them in
  either direction may run at the same time; a task linked downstream of
  another starts only after it — the "waterfall" and "parallel" of the request
  are the two ends of this one model.
- **Harness.** The agent command-line tool that runs a session: `claude` or
  `opencode` (spec 0012). Its interactive text user interface (TUI) runs in a
  pseudo-terminal (pty), the same way the wall's launched cards run today.
- **Turn.** One agent reply, from a prompt arriving to the agent handing
  control back.
- **Convergence marker.** The literal line `CONVERGED` the agent is told to end
  its reply with once the task's stop criteria are met.
- **Check command.** An optional shell command a converged reply must also
  pass (exit status 0) before the task counts as converged, e.g. `pnpm test`.
- **Bracketed paste.** The terminal convention (`ESC[200~` … `ESC[201~`) that
  delivers multi-line text to a TUI as one paste instead of a sequence of
  Enter presses.
- **Worktree.** A `git worktree`: a second working folder of the same
  repository on its own branch.

## Decisions taken in design

Recorded with the operator on 2026-09-27; the alternatives are listed so a
later change reopens a decision knowingly.

| Question | Decision | Alternatives not taken |
|---|---|---|
| How a task runs | Interactive TUI in a pty, visible as a wall card | Headless (`claude --print`, `opencode run`): precise exit status, but no live card and no take-over |
| When a looping task is done | Agent ends its reply with the convergence marker, guided by per-task stop criteria appended to the prompt; an optional check command must also pass; a maximum iteration count always applies | Check command only; a separate judge model |
| What one loop iteration does | Paste a follow-up prompt into the same session | A fresh session per iteration |
| Shape of a schedule | Dependency graph | Stages; a flat list with one mode |
| What a failure does | Pause the run for the operator (retry, skip, abort); running siblings finish | Stop the run; carry on |
| Where a task works | Per task: the project folder, a new worktree, or the workspace of an upstream task; tasks that may run at the same time must not share a folder | Always a worktree; always the project folder |
| Hand-off between tasks | Placeholders in the prompt for an upstream task's reply and worktree | None |
| How a run starts | A Run button | Timed or recurring starts |

## Non-goals

- Timed or recurring runs. A run starts when the operator presses Run.
- Headless tasks. Every task is an interactive session on the wall.
- Merging worktrees. A task's worktree and branch are kept for the operator to
  review and merge; the schedule never merges, rebases or pushes.
- Drawing the graph on a canvas. The sidebar shows it as a layered list (below).
- Sharing a run across windows. Like the wall today, the backend's pushes reach
  the most recently opened window
  (`docs/memory/darkfactory-push-reaches-only-the-newest-window.md`); the run
  itself lives in the backend and is unaffected by which window watches it.
- Harnesses beyond `claude` and `opencode`.

## Design

### Model

`common/schedule/schedule-types.ts` (browser-safe, no `node:` imports):

```ts
interface Schedule { id: string; name: string; tasks: ScheduleTask[] }

interface ScheduleTask {
  id: string;                  // [a-z0-9-]{1,32}, unique in the schedule
  name: string;
  needs: string[];             // ids of the tasks this one waits for
  project: string;             // absolute folder
  workspace:
    | { kind: "folder" }                       // the project folder as is
    | { kind: "worktree" }                     // new worktree, branch spexr/<schedule>/<task>
    | { kind: "sameAs"; task: string };        // an upstream task's workspace
  harness: HarnessId;          // "claude" | "opencode"
  configDir?: string;          // Claude account; ignored for opencode (spec 0013)
  model?: string;              // [A-Za-z0-9._/:\[\]-]{1,100}
  permissionMode?: string;     // claude: acceptEdits | auto | bypassPermissions | manual | dontAsk | plan;
                               // opencode: auto (maps to --auto)
  prompt: string;              // 1..20 000 characters, not starting with "-"
  loop?: {
    stopCriteria: string;      // appended to the first prompt
    followUp: string;          // pasted on every later iteration
    maxIterations: number;     // 1..50
    check?: string;            // shell command, run in the workspace
    checkTimeoutSec?: number;  // default 600
  };
}
```

`validateSchedule(schedule)` is pure and returns every problem, not the first.
It rejects:

- an unknown id in `needs` or `sameAs`, and duplicate task ids;
- a cycle, naming the tasks on it;
- a `sameAs` that points at a task that is not upstream (reachable through
  `needs`);
- a placeholder naming a task that is not upstream;
- two tasks that may run at the same time (no path between them) whose
  workspaces resolve to the same folder — this is what keeps each running
  session distinguishable, since Dark Factory liveness is per folder
  (spec 0011, non-goals);
- a harness id outside the whitelist, and a `maxIterations` outside 1..50;
- a permission mode the task's harness does not offer, and a model name outside
  its pattern;
- an empty prompt, one longer than 20 000 characters, and one starting with `-`
  (the harness would read it as an option).

### Store

`node/schedule/schedule-store.ts` keeps schedules and the state of their runs
in `~/.spexr/schedules.json` (override: `SPEXR_SCHEDULES`), written atomically
(temporary file then rename) like `project-names-store.ts`. A schedule holds
one run at a time; pressing Run again after a run has finished or been
aborted replaces the stored run. A schedule is validated on every save; an
invalid one is saved but cannot be run.

### Engine

`node/schedule/schedule-engine.ts` is a pure state machine: it takes the
schedule, the run state and an event, and returns the new run state plus the
effects to perform (start task, paste follow-up, run check, create worktree,
close session).
All input/output lives in a thin runner around it, so every rule is testable
without a process.

Task states: `pending` → `starting` → `running(iteration)` →
`converged` | `failed` | `skipped`, plus `waiting-on-you` (the session stopped
at a permission prompt: spec 0011's certain "needs you") and `interrupted`.

- A task becomes ready when every task in its `needs` is `converged` or
  `skipped`. Every ready task starts at once.
- A task that fails pauses the run: tasks already running go on to their end;
  no new task starts. The operator then retries the task (from iteration 1, in
  the same workspace), skips it (its dependents may start; a placeholder
  pointing at it renders empty — but a `sameAs` dependent of a `worktree` task
  skipped before it started fails to start instead, as under **Launch**), or
  aborts the run.
- Retry starts the task at once, even while the run is paused; an operator
  pause then holds its turn end like any other. Nothing of the failed attempt
  is carried over (terminal, session, reply, error), and its session is closed
  if it is still open, because the new session works in the same folder. An
  interrupted task's session is never closed: its terminal id died with the old
  backend and may now belong to another process. Skip leaves the failed session
  open for the operator to read. After either, the run stays paused on a
  failure only while another task is still failed or interrupted; an operator
  pause is kept. Both apply only to a failed or interrupted task.
- `waiting-on-you` is not a failure: it returns to `running` when the session
  moves again.
- Pause (operator) stops new tasks from starting and stops follow-up pastes.
  Resume lifts the operator's pause; the run stays paused on the failure while
  a task is still failed or interrupted, until Retry or Skip clears it. Abort
  ends the run; its sessions stay open on the wall.
- If the backend starts with a run marked running (the app quit or crashed
  mid-run), its running tasks become `interrupted` and the run is paused. The
  operator retries or skips each one.

### Launch

The login-shell launch line the wall uses today
(`browser/darkfactory/darkfactory-terminal-manager.ts`, `launchPlan` and
`resolveShell`) moves into a shared `common/` builder, so the wall and the
schedule start sessions the same way and keep spec 0011's AC-8: the account
(`CLAUDE_CONFIG_DIR` exported or unset) and `cd` into the folder happen inside
the one quoted `-c` line of a login shell.

**The frontend resolves how to launch.** Which binary runs and which account it
runs under come from preferences (launch profiles, the executable preference,
the active profile), and preferences live in the frontend. So when the operator
presses Run or Retry, the frontend resolves each task's launch plan (command,
config dir to export, whether the command is a shell word) and its account
directory, exactly as it does for a wall session today, and sends them with the
request. The backend stores them in the run state and uses them for that run.

The runner starts a task's pty through Theia's `ShellTerminalServer` on the
backend and records its terminal id and process id. A scheduled task's shell
line ends when the harness does — it omits the `; exec "$SHELL" -i` the wall
appends to keep a terminal open — so the harness exiting is seen as the pty
exiting. The harness arguments:

| | claude | opencode |
|---|---|---|
| First prompt | positional argument | `--prompt` |
| Model | `--model` | `-m` |
| Permissions | `--permission-mode` | `--auto` when set to `auto` |
| Session id | `--session-id <uuid>` chosen by the runner | the first session the wall's scan finds in the task's folder that it did not know at launch |

The first prompt is the task prompt with placeholders filled in, then — when
the task loops — the stop criteria, then a fixed instruction to end the reply
with the line `CONVERGED` once they are met. Every argument is shell-quoted
(spec 0011, Security).

The workspace is prepared before launch. A `worktree` task runs
`git worktree add -b spexr/<schedule>/<task> <path> HEAD` in the project's
repository (`git -C <project> rev-parse --show-toplevel`), with `<path>` a
sibling folder `<repo>-spexr-<schedule>-<task>`, so it starts from the
project's last commit; uncommitted changes stay behind. When the project is a
folder inside its repository, the task works in the same folder inside the
worktree. Git runs with an argument list, never through a shell, one worktree
change at a time per repository. A retry reuses the task's worktree, or makes
one for its branch when only the branch is left. A new run refuses a worktree
or branch left from an earlier run and names the commands that remove them;
Retry continues on them instead. A `sameAs` task runs in the folder its
upstream actually used; when the upstream never got one (a worktree task
skipped before it started), the task fails to start rather than fall back to
the project folder.

A pty that starts for a run that has meanwhile been aborted or replaced, or
whose watcher cannot be registered, is closed: it has no card and nothing
watches it.

### Turn end and convergence

**Claude.** Until the transcript exists, the session may be waiting at a
startup dialog (folder trust, bypass-mode confirmation): after 8 seconds
without one the task shows *Needs you*, and it fails only if its pty exits.
The runner finds the transcript at
`<account dir>/projects/*/<session id>.jsonl`, using the account directory the
frontend resolved, and follows it with the incremental reader the wall already
uses (`node/darkfactory/follow-reader.ts`). It reads the turn with the same
rules as `classifySession` (`node/darkfactory/session-state.ts`), so a turn end
is seen as it is written, not on the wall's 20-second poll.

**opencode.** opencode cannot be given a session id and has no transcript file:
its sessions are read with `opencode db` queries, and each query writes
opencode's data folder, which the wall watches — polling it from the runner
would restart the refresh loop the wall already throttles
(`docs/memory/a-read-only-opencode-db-query-still-writes-its-data-dir-open.md`).
The runner therefore reads opencode tasks from the wall's own scan results: the
Dark Factory backend announces each scan to the runner, and while an opencode
task runs the runner holds the wall's one 20-second poll on, so scans continue
with no window open (paused for power saving, like the wall's own).
A turn end on an opencode task is seen tens of seconds late.

**A turn counts once.** After a paste, the transcript still ends with the
previous reply until the new prompt is written; the runner only accepts a turn
end after it has seen the agent working again. The final reply is the whole
last assistant turn — every assistant entry after the last prompt — not only
the last entry.

When a turn ends:

1. The final reply's last non-empty line is `CONVERGED`: run the check command
   if there is one (in the workspace, in a login shell, with its timeout; on
   timeout its whole process group is killed). Checks run one at a time across
   the backend, queued in order: parallel tasks all running `pnpm test` at once
   would overload the machine. It
   passes, or there is none → `converged`. It fails → treated as "not
   converged", and its last 40 lines of output are appended to the follow-up.
2. Not converged and iterations left → paste `followUp` as a bracketed paste,
   then Enter; iteration + 1.
3. Not converged and no iterations left → `failed`.

A task without `loop` converges on its first turn end.

A session that exits (its process ends) before converging → `failed`.

### Hand-off

A prompt may use `{{<task>.reply}}` (that task's final reply, marker line
removed) and `{{<task>.workspace}}` (its folder). They are filled in when the
task starts. Placeholders are never substituted into a check command.

### Sidebar

A collapsible pane on the right edge of the Dark Factory, inside its React root
(`.spexr-df-root` becomes a row: the wall, then the schedule pane). Its width
and open state are kept per window in localStorage. Theia's right panel is not
used: the Dark Factory's sidebar policy collapses it on purpose
(`browser/darkfactory/darkfactory-sidebar-policy.ts`).

Contents, top to bottom:

- The schedule picker and New / Duplicate / Delete.
- The run bar: Run, Pause / Resume, Abort, and the run's state.
- The graph as a **layered list**: tasks grouped by depth (a task's depth is
  one more than its deepest upstream task), each layer a band, each task a row
  with its name, harness, workspace, state chip and iteration count
  (`2 / 5`). A row lists the tasks it waits for; selecting a task highlights
  them. A `failed` or `interrupted` row also offers Retry and Skip.
- The task editor, opened from a row: project, workspace, harness, account,
  model, permission mode, prompt (with a placeholder picker listing only
  upstream tasks), loop settings, "waits for" (a multi-select of the other
  tasks). Validation problems show inline, next to the field they concern,
  as the operator types.

A running task is a launched card on the wall, attached to the run's terminal
by its terminal id (the path pinned cards use after a reload,
`DarkfactoryTerminalManager.reattach`). Selecting a task row scrolls to and
focuses its card. The card shows the task name and iteration because the runner
names the session `<schedule> · <task> (<iteration>/<max>)` through the wall's
session-rename store, and renames it on every iteration.

### Look and feel

The sidebar follows UX and visual-design practice, built on the
`@sondalab/ui-kit` the rest of SPEXR uses:

- **Kit first.** Controls are kit components — `sl-btn`, `sl-icon-btn`,
  `sl-field`, `sl-select`, `sl-switch`, `sl-segmented`, `sl-tag`, `sl-badge`,
  `sl-callout`, `sl-empty`, `sl-rule`, `sl-tooltip` — and colours, type and
  spacing come from kit tokens (`--sl-*`). No raw colour values; new tokens,
  if any, carry the `--sl-` prefix (`docs/memory/theme-architecture.md`). Both
  themes are checked.
- **One primary action.** Run is the only primary button; Pause and Abort are
  secondary, Abort asks for confirmation inline, not in a modal.
- **State is never colour alone.** Every task state has a label and an icon as
  well as a colour; a running task's chip uses the kit's live light only while
  the session is actually working, as the wall's cards do.
- **Progressive disclosure.** The loop settings stay folded until "Loop until
  converged" is switched on; advanced harness options (model, permission mode)
  sit in a folded section.
- **Errors where they happen.** Validation problems sit next to the field;
  a run that cannot start lists why above the Run button.
- **Empty and first-run states** use `sl-empty` with one sentence and one
  action.
- **Keyboard and screen reader.** Every control is reachable by keyboard with a
  visible focus ring; rows are a list with `aria-current` on the selected task;
  state changes are announced through a polite live region.
- **Motion** uses the kit's durations and easing and respects
  `prefers-reduced-motion`.
- **Low-battery mode** stops the sidebar's decorative effects like the rest of
  the app (`power-save`).

## Acceptance criteria

### Slice 1 — Model, validation and store

- **AC-1** `validateSchedule` reports every rule listed under **Model**, each
  problem naming the task and field it concerns.
- **AC-2** Two tasks that may run at the same time and resolve to the same
  folder are rejected; the same two tasks linked by `needs` are accepted.
- **AC-3** Schedules survive a backend restart through `~/.spexr/schedules.json`,
  written atomically; `SPEXR_SCHEDULES` overrides the path.

### Slice 2 — One task, end to end

- **AC-4** The launch line is built by one shared builder used by both the wall
  and the schedule; the wall's shell line stays byte-identical to today's,
  pinned by tests written against the current code before the move.
- **AC-5** Run on a one-task schedule starts the session in a backend pty with
  the prompt, model and permission mode given; it appears as a launched card on
  the wall within the time the wall takes today, and survives a window reload.
- **AC-6** A Claude task's session is identified by the `--session-id` the
  runner chose, its transcript found under the account the frontend resolved;
  an opencode task's session is the first one the wall's scan finds in its
  folder that was not known at launch, read from the wall's scan without any
  extra `opencode db` query.
- **AC-7** The task becomes `converged` when its first turn ends, and
  `waiting-on-you` while the session stops at a permission prompt.
- **AC-8** A minimal sidebar lists the schedule's tasks with their state and
  offers Run and Abort; it meets **Look and feel** for what it shows.

### Slice 3 — Loop until converged

- **AC-9** The first prompt carries the stop criteria and the marker
  instruction; later iterations paste `followUp` as a bracketed paste then
  Enter, and the session receives it as one prompt.
- **AC-10** A reply ending in `CONVERGED` runs the check command; a pass
  converges the task, a failure or timeout starts another iteration with the
  command's last 40 lines of output appended to the follow-up.
- **AC-11** Reaching `maxIterations` without converging fails the task.

### Slice 4 — The graph

- **AC-12** Every ready task starts at once; a task starts only after all of
  its `needs` have converged or been skipped.
- **AC-13** `worktree` tasks get a fresh worktree on
  `spexr/<schedule>/<task>` from the project's `HEAD`, mapped to the project's
  own subfolder inside it when the project sits inside its repository; a retry
  reuses that worktree or rebuilds it from the branch when only the branch is
  left; a new run refuses a worktree or branch left from an earlier run and
  names the commands that remove them. `sameAs` tasks run in the folder their
  upstream actually used, and fail to start if that upstream was skipped
  before it got one; worktrees remain after the run.
- **AC-14** `{{<task>.reply}}` and `{{<task>.workspace}}` are filled in at
  start; a skipped task's placeholders render empty.
- **AC-15** A failed task pauses the run; running tasks finish; retry, skip and
  abort behave as under **Engine**. Pause and Resume work at any time.
- **AC-16** A run interrupted by a backend restart comes back paused with its
  running tasks `interrupted`.
- **AC-17** The full sidebar (layered list, editor, placeholder picker, inline
  validation) meets every point of **Look and feel**, checked in both themes and
  with the keyboard only.

## Security

- The operator writes prompts, check commands and folders; nothing reaches a
  shell from anywhere else. Prompts and folders are shell-quoted arguments;
  harness ids and task ids are whitelisted by pattern.
- A placeholder may carry an upstream agent's reply — model output — into a
  prompt. It goes in as quoted text for the next agent to read, never into a
  shell command: placeholders are not expanded in check commands, and the
  follow-up is pasted into the TUI, not run.
- Check commands run with the operator's own rights, in the task's workspace,
  in a login shell, like the launch line; each has a timeout and is killed when
  it expires.
- A permission mode that approves tools without asking (claude `auto` and
  `bypassPermissions` — the two `classifySession` already treats as
  auto-approving — and opencode `auto`) is shown with a warning in the editor
  and on the task row.
- The launch plan reaches the backend over the frontend's RPC connection, and
  the backend runs its command in a login shell. This is the same trust the
  wall already places in the frontend (the frontend asks the backend's terminal
  server to run exactly that line today); the backend still quotes every
  argument and checks that the command is non-empty and has no newline.

## Testing

Vitest, next to each module, with `--maxWorkers=2`
(`docs/memory/never-run-full-pnpm-test-or-the-full-e2e-suite-unthrottled-i.md`):

- `validateSchedule`: one test per rule, plus the concurrency-guard cases.
- The engine as a table of (state, event) → (state, effects), covering ready
  sets, pause on failure, retry, skip, abort, restart recovery and iteration
  limits.
- Prompt assembly and placeholder filling; marker detection on the last line
  only.
- The launch-line builder, shared with the wall's existing tests.
- The store with a temporary path, including an interrupted write.
- The runner against a fake pty and a fixture transcript: a turn end triggers
  the check, a failed check triggers the paste.

## Risks

- **Probe results (2026-09-27, Claude Code in a scripted pty).**
  - `claude --session-id <uuid> '<prompt>'` writes
    `<account dir>/projects/<encoded cwd>/<uuid>.jsonl` (seen under
    `~/.claude-perso` with that account exported). Confirmed.
  - **A folder Claude has not seen shows a trust dialog before anything is
    written**, and its default answer is "No, exit". So a missing transcript
    in the first seconds usually means "waiting for the operator", not
    "failed": the runner reports such a task as *Needs you* after 8 seconds
    without a transcript, and fails it only if the pty exits. Every new
    worktree (Slice 4) is a new folder and will ask once.
    The operator answers it in the task's card: choose "Yes" (the default
    answer ends the session and fails the task). The schedule never edits
    Claude's own settings to skip the dialog; a schedule with Claude worktree
    tasks is therefore not unattended.
  - `--permission-mode bypassPermissions` showed no extra dialog, but only
    because the account has `skipDangerousModePermissionPrompt: true`; other
    accounts get a first-use confirmation, handled by the same *Needs you* rule.
  - A bracketed paste (`ESC[200~…ESC[201~`) then Enter, sent to an idle
    Claude TUI, arrives as one user message with both lines. Confirmed for
    Claude; not tried for opencode.
  - A Claude started with `CLAUDE_CODE_CHILD_SESSION` in its environment (a
    SPEXR launched from inside a Claude Code session) runs with transcript
    saving off. The backend terminal server merges the backend's own
    environment into every pty, so scheduled ptys clear the `CLAUDECODE` and
    `CLAUDE_CODE_*` variables.
  - Theia's terminal server creates a pty with no window connected: every use
    of its client is guarded (`base-terminal-server.js`), and `create` does
    not touch it. Attaching a later window by terminal id is the path pinned
    cards already use after a reload. Checked in code, not in the app.
- **Pasting into opencode (probe, 2026-09-27, opencode 1.18.18, scripted
  pty).** After a first turn, a bracketed paste of two lines then Enter
  arrived as one user message and got one reply. Confirmed, so opencode tasks
  loop by paste like Claude tasks. The earlier `--resume` fallback is dropped:
  resuming ends the pty (the engine would read it as a failure) and gives the
  task a new terminal, losing its card.
- **opencode session pick-up.** Matching "first unknown session in the folder"
  relies on the concurrency guard; if a session started outside the schedule
  lands in the same folder at the same moment, the runner could adopt it. The
  runner records the chosen id and shows it on the task row.
- **opencode latency.** Turn ends on opencode tasks follow the wall's scan
  throttle, so a looping opencode task spends tens of seconds between
  iterations.
- **Backend terminals without a window.** That Theia's terminal server creates
  and runs a pty with no window connected, and that a window opened later
  attaches to it through `reattach`, is expected from its code, not yet tried.
  Slice 2 opens with that probe.
- **Marker in quoted text.** An agent quoting its instructions could end a
  reply with the marker by accident; only the last non-empty line counts, and
  the check command is the stronger gate where the operator sets one.
