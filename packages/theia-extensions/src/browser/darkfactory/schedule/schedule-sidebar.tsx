import * as React from "@theia/core/shared/react";
import type { ClaudeConfigDir } from "../../../common/darkfactory-protocol.js";
import type { HarnessId } from "../../../common/harness/harness-types.js";
import type { ScheduleSnapshot } from "../../../common/schedule/schedule-protocol.js";
import {
  DEFAULT_CHECK_TIMEOUT_SEC,
  MAX_CHECK_TIMEOUT_SEC,
  MAX_ITERATIONS,
  PERMISSION_MODES,
  isUnattended,
  type Schedule,
  type ScheduleTask,
  type TaskLoop,
  type ValidationProblem,
} from "../../../common/schedule/schedule-types.js";
import { validateSchedule } from "../../../common/schedule/schedule-validate.js";
import { patchLoop, withCheck, withCheckTimeout, withLoop, withMaxIterations } from "./loop-edit.js";
import {
  bandsOf,
  duplicateSchedule,
  focusRequestFate,
  newSchedule,
  newTask,
  pendingKey,
  runBar,
  taskRows,
  taskTransitions,
  upstreamHighlight,
  withPending,
  type TaskRow,
} from "./schedule-view.js";
import { DraftSaver } from "./draft-saver.js";
import {
  accountOptions,
  handOffRange,
  insertAt,
  needChoices,
  placeholderChoices,
  staleWorkspaceOption,
  withAccount,
  withNeed,
  withWorkspace,
  withoutTask,
  workspaceOptions,
  workspaceValue,
} from "./task-edit.js";

/**
 * Where focus goes once its target mounts, after a change that unmounts
 * whatever was focused. "run-bar" and "row" carry the schedule they were
 * raised for, since a switch to a different schedule (including the one a
 * delete falls back to) can leave a stale request pointing at a same-id
 * task or run bar that means something else there.
 */
type FocusTarget =
  | { kind: "new-schedule" }
  | { kind: "run-bar"; scheduleId: string }
  | { kind: "row"; scheduleId: string; taskId: string };

export interface ScheduleSidebarProps {
  snapshot: ScheduleSnapshot;
  projects: readonly { path: string; name: string }[];
  /** The Claude accounts the wall's launcher knows; a task picks one. */
  configs: readonly ClaudeConfigDir[];
  width: number;
  onSave(schedule: Schedule): void;
  onRemove(scheduleId: string): void;
  /** Resolves to the problems that refused the run (empty on success), so they can join the reasons above Run. */
  onRun(schedule: Schedule): Promise<ValidationProblem[]>;
  onAbort(scheduleId: string): void;
  /**
   * No new task starts and no follow-up is pasted until onResume. Resolves to
   * the problems that refused pause/resume (empty on success), the same way
   * onRun does, so a rejection surfaces above the run bar instead of being
   * swallowed.
   */
  onPause(scheduleId: string): Promise<ValidationProblem[]>;
  onResume(scheduleId: string): Promise<ValidationProblem[]>;
  /** Start a failed or interrupted task again; resolves to the problems that refused it. */
  onRetry(scheduleId: string, taskId: string): Promise<ValidationProblem[]>;
  /** Let its dependents start without it; resolves to the problems that refused it. */
  onSkip(scheduleId: string, taskId: string): Promise<ValidationProblem[]>;
  onFocusTask(scheduleId: string, taskId: string): void;
  onClose(): void;
}

/** The plant schedule pane: pick a schedule, see its tasks by layer, run it. */
export function ScheduleSidebar(p: ScheduleSidebarProps): React.ReactElement {
  const [selectedId, setSelectedId] = React.useState<string | undefined>(
    p.snapshot.schedules[0]?.id,
  );
  const [editing, setEditing] = React.useState<string | undefined>();
  const [confirmAbort, setConfirmAbort] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  // The selected row: aria-current, its card focused while running, and its upstream highlighted.
  const [selected, setSelected] = React.useState<string | undefined>();
  // Task ids with a Retry or Skip call in flight: their buttons are disabled
  // for that stretch, so a double click cannot queue a second call that
  // resolves after the first and overwrites its (possibly empty) result.
  const [pendingTasks, setPendingTasks] = React.useState<ReadonlySet<string>>(new Set());
  // Edits go to a local draft and are saved after a pause in typing: saving
  // every keystroke over RPC made controlled inputs lag and drop characters.
  const [draft, setDraft] = React.useState<Schedule | undefined>();
  // The unsaved edit and its timer; it saves through the latest onSave, and
  // closing the pane saves an edit typed moments before instead of losing it.
  const onSaveRef = React.useRef(p.onSave);
  onSaveRef.current = p.onSave;
  const [saver] = React.useState(() => new DraftSaver<Schedule>((d) => onSaveRef.current(d), 600));
  // Keyboard focus around the two inline confirms (AC-17): opening one moves
  // focus to its "Keep" button; keeping returns it to the button that opened
  // it; deleting moves it on to the schedule picker, since the trash button
  // it came from is gone once the schedule is removed.
  const deleteBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const deleteKeepBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const abortBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const abortKeepBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const scheduleSelectRef = React.useRef<HTMLSelectElement | null>(null);
  // The same recovery, for changes that arrive from the backend rather than
  // from a local click: deleting the last schedule, a confirmed or a
  // run-ended Abort, and a Retry/Skip whose buttons are about to disappear.
  // Consumed once its target has mounted, so it survives a render or two of
  // lag between setting the intent and the DOM catching up.
  const [focusTarget, setFocusTarget] = React.useState<FocusTarget | undefined>(undefined);
  const sidebarRootRef = React.useRef<HTMLElement | null>(null);
  const newScheduleBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const runBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const runBarRef = React.useRef<HTMLDivElement | null>(null);
  const rowBtnRefs = React.useRef(new Map<string, HTMLButtonElement>());
  // Whichever "Add a task" button is showing: where focus goes once a removed task's editor is gone.
  const addTaskBtnRef = React.useRef<HTMLButtonElement | null>(null);
  // Only worth requesting a focus recovery while focus is still somewhere we
  // can reason about: inside the sidebar (about to unmount) or already
  // reverted to the body. If it's already elsewhere — a card the wall just
  // focused, a terminal the operator clicked into — requesting one here
  // would steal it back once the guard below happens to see the body again.
  const canRequestFocus = (): boolean => {
    const active = document.activeElement;
    return !active || active === document.body || (sidebarRootRef.current?.contains(active) ?? false);
  };
  const saved = p.snapshot.schedules.find((s) => s.id === selectedId) ?? p.snapshot.schedules[0];
  const schedule = draft && draft.id === saved?.id ? draft : saved;
  const run = schedule ? p.snapshot.runs[schedule.id] : undefined;
  const running = run?.status === "running";
  // What the backend refused the last Run for, tagged with the schedule it
  // was run against. Run is async: the operator can switch, add or remove a
  // schedule before it resolves, so the result is only ever shown when
  // `scheduleId` still matches the schedule on screen — otherwise a refusal
  // (or the all-clear empty array) meant for one schedule would land on, or
  // wipe, whatever the operator has since switched to. Cleared the same way
  // on the next edit or a run that started cleanly.
  const [runProblems, setRunProblems] = React.useState<{ scheduleId: string; problems: ValidationProblem[] } | undefined>(undefined);
  const edit = (next: Schedule): void => {
    setRunProblems(undefined);
    setDraft(next);
    saver.edit(next);
  };
  const flush = (): void => saver.flush();
  React.useEffect(() => () => saver.dispose(), [saver]);
  const problems: ValidationProblem[] = schedule
    ? [...validateSchedule(schedule), ...(runProblems?.scheduleId === schedule.id ? runProblems.problems : [])]
    : [];
  const bar = schedule ? runBar(schedule, run, problems) : undefined;
  const nameProblem = problems.find((x) => !x.task && x.field === "name")?.message;
  const rows = schedule ? taskRows(schedule, run) : [];
  const upstream = schedule ? upstreamHighlight(schedule, selected) : new Set<string>();
  const [announce, setAnnounce] = React.useState("");
  const rowKey = rows.map((r) => `${r.id}:${r.status}`).join(",");
  const prevRowsRef = React.useRef<TaskRow[] | undefined>(undefined);
  const prevBarLabelRef = React.useRef<string | undefined>(undefined);
  // One live region for the whole pane (see the aside's trailing span):
  // schedule-level state changes and per-task transitions both funnel here,
  // so a screen reader never hears two competing announcements at once.
  React.useEffect(() => {
    const lines: string[] = [];
    if (bar && bar.label !== prevBarLabelRef.current) lines.push(`Schedule ${bar.label.toLowerCase()}`);
    lines.push(...taskTransitions(prevRowsRef.current, rows));
    prevBarLabelRef.current = bar?.label;
    prevRowsRef.current = rows;
    if (lines.length > 0) setAnnounce(lines.join(". "));
    // Depends on rowKey (content), not rows (a new array every render) or bar
    // (a new object every render) — only bar.label is read.
  }, [rowKey, bar?.label]);
  React.useEffect(() => {
    // A run ending (or starting) leaves no refusal worth keeping: a stale
    // Retry/Skip rejection from mid-run must not go on disabling Run once
    // the run itself is over. A refusal from Run happens while `running`
    // stays false throughout, so this effect does not fire for it and the
    // reasons above Run are left alone.
    setRunProblems(undefined);
    if (!running) {
      // The abort confirm was still open when the run ended on its own (not
      // from that confirm's own Abort button, which sets its own request):
      // only worth a request if focus was actually still on it.
      if (confirmAbort && schedule && canRequestFocus()) setFocusTarget({ kind: "run-bar", scheduleId: schedule.id });
      setConfirmAbort(false);
    } else setConfirmDelete(false);
  }, [running]);
  React.useEffect(() => {
    if (!focusTarget) return;
    // A switch to a different schedule (including the one a delete falls
    // back to) outdates a run-bar or row request from the one left behind:
    // a same-id row or run bar there means something else entirely.
    if (focusTarget.kind !== "new-schedule" && focusTarget.scheduleId !== schedule?.id) {
      setFocusTarget(undefined);
      return;
    }
    const active = document.activeElement;
    const activeIsBody = !active || active === document.body;
    const activeInside = !activeIsBody && (sidebarRootRef.current?.contains(active) ?? false);
    const fate = focusRequestFate(activeInside, activeIsBody);
    if (fate === "drop") {
      setFocusTarget(undefined);
      return;
    }
    if (fate === "wait") return;
    const el: HTMLElement | null =
      focusTarget.kind === "new-schedule"
        ? newScheduleBtnRef.current
        : focusTarget.kind === "row"
          ? (rowBtnRefs.current.get(focusTarget.taskId) ?? null)
          : (abortBtnRef.current ??
            (runBtnRef.current && !runBtnRef.current.disabled ? runBtnRef.current : null) ??
            runBarRef.current);
    if (!el) return; // not mounted yet; focus is still on the body, so try again once it is
    el.focus();
    setFocusTarget(undefined);
  }, [focusTarget, running, rowKey, schedule?.id]);

  const addSchedule = (): void => {
    // Flush any pending edit to the schedule being left, and drop the local
    // draft: a freed id (from a delete) can be reused by newSchedule, and a
    // stale draft with that id would resurrect the deleted content over it.
    flush();
    setDraft(undefined);
    setRunProblems(undefined);
    setSelected(undefined);
    setConfirmDelete(false);
    const s = newSchedule(new Set(p.snapshot.schedules.map((x) => x.id)));
    p.onSave(s);
    setSelectedId(s.id);
  };
  const duplicate = (): void => {
    if (!schedule) return;
    const copy = duplicateSchedule(schedule, new Set(p.snapshot.schedules.map((x) => x.id)));
    flush();
    setDraft(undefined);
    setRunProblems(undefined);
    setSelected(undefined);
    setConfirmDelete(false);
    p.onSave(copy);
    setSelectedId(copy.id);
  };
  /**
   * Retry or Skip; a refusal joins the reasons above Run, like a refused run.
   * The task stays pending (its Retry/Skip buttons disabled) for the length
   * of the call, so a double click cannot start a second one that resolves
   * after the first and clobbers its result with a stale refusal.
   */
  const taskAction = (act: (sid: string, tid: string) => Promise<ValidationProblem[]>, taskId: string): void => {
    if (!schedule) return;
    const scheduleId = schedule.id;
    const key = pendingKey(scheduleId, taskId);
    setPendingTasks((prev) => withPending(prev, key, true));
    void act(scheduleId, taskId)
      .then((problems) => {
        setRunProblems({ scheduleId, problems });
        // Its own Retry/Skip buttons are about to unmount once the run's
        // next snapshot marks the task no longer retryable; land on the
        // row itself instead of losing focus to the body. Only worth
        // requesting while focus is still where we can reason about it —
        // by the time this resolves the operator may already be in the new
        // card the wall opened, or have switched to a different schedule.
        if (problems.length === 0 && canRequestFocus()) setFocusTarget({ kind: "row", scheduleId, taskId });
      })
      .finally(() => setPendingTasks((prev) => withPending(prev, key, false)));
  };
  const removeSchedule = (id: string): void => {
    if (draft?.id === id) {
      saver.discard();
      setDraft(undefined);
    }
    setRunProblems(undefined);
    setEditing(undefined);
    setSelected(undefined);
    setConfirmDelete(false);
    p.onRemove(id);
  };
  const updateTask = (task: ScheduleTask): void => {
    if (!schedule) return;
    edit({ ...schedule, tasks: schedule.tasks.map((t) => (t.id === task.id ? task : t)) });
  };
  const removeTask = (taskId: string): void => {
    if (!schedule || running) return;
    edit(withoutTask(schedule, taskId));
    setEditing(undefined);
    if (selected === taskId) setSelected(undefined);
    requestAnimationFrame(() => addTaskBtnRef.current?.focus());
  };
  const addTask = (): void => {
    if (!schedule) return;
    const t = newTask(p.projects[0]?.path ?? "", new Set(schedule.tasks.map((x) => x.id)));
    edit({ ...schedule, tasks: [...schedule.tasks, t] });
    setEditing(t.id);
  };

  return (
    <aside ref={sidebarRootRef} className="spexr-sched" style={{ width: p.width }} aria-label="Plant schedule">
      <header className="spexr-sched__head">
        <span className="sl-eyebrow">Plant schedule</span>
        <button
          className="sl-icon-btn sl-fx-glass sl-fx-glass--pane sl-fx-press"
          onClick={p.onClose}
          aria-label="Close the schedule"
          title="Close"
        >
          <i className="codicon codicon-layout-sidebar-right-off" />
        </button>
      </header>
      {!schedule ? (
        <div className="sl-empty">
          <p>Lay out agent sessions, say which waits for which, and run them.</p>
          <button ref={newScheduleBtnRef} className="sl-btn sl-fx-glass sl-fx-glass--pane sl-fx-press" onClick={addSchedule}>
            New schedule
          </button>
        </div>
      ) : (
        <>
          <div className="spexr-sched__picker">
            <label className="sl-field">
              <span className="sl-field__label">Schedule</span>
              <span className="sl-field__control">
                <span className="sl-select">
                  <select
                    ref={scheduleSelectRef}
                    className="sl-field__input"
                    value={schedule.id}
                    onChange={(e) => {
                      flush();
                      setDraft(undefined);
                      setRunProblems(undefined);
                      setSelected(undefined);
                      setConfirmDelete(false);
                      setSelectedId(e.target.value);
                    }}
                  >
                    {p.snapshot.schedules.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </span>
              </span>
            </label>
            <button
              className="sl-icon-btn sl-fx-glass sl-fx-glass--pane sl-fx-press"
              onClick={addSchedule}
              aria-label="New schedule"
              title="New schedule"
            >
              <i className="codicon codicon-add" />
            </button>
            <button className="sl-icon-btn sl-fx-glass sl-fx-glass--pane sl-fx-press" onClick={duplicate} aria-label="Duplicate this schedule" title="Duplicate this schedule">
              <i className="codicon codicon-copy" />
            </button>
            <button
              ref={deleteBtnRef}
              className="sl-icon-btn sl-icon-btn--danger sl-fx-glass sl-fx-glass--pane sl-fx-press"
              onClick={() => {
                setConfirmDelete(true);
                requestAnimationFrame(() => deleteKeepBtnRef.current?.focus());
              }}
              disabled={running}
              aria-expanded={confirmDelete && !running}
              aria-label="Delete this schedule"
              title="Delete this schedule"
            >
              <i className="codicon codicon-trash" />
            </button>
          </div>
          {confirmDelete && !running && (
            <span className="spexr-sched__confirm" role="group" aria-label="Confirm delete">
              <span className="spexr-sched__confirm-text">Delete “{schedule.name}”?</span>
              <button
                className="sl-btn sl-btn--danger sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
                onClick={() => {
                  const wasLast = p.snapshot.schedules.length <= 1;
                  setConfirmDelete(false);
                  removeSchedule(schedule.id);
                  // The last schedule's delete takes the picker down with
                  // it, into the empty state's "New schedule" button.
                  if (wasLast && canRequestFocus()) setFocusTarget({ kind: "new-schedule" });
                  else requestAnimationFrame(() => scheduleSelectRef.current?.focus());
                }}
              >
                Delete
              </button>
              <button
                ref={deleteKeepBtnRef}
                className="sl-btn sl-btn--ghost sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
                onClick={() => {
                  setConfirmDelete(false);
                  requestAnimationFrame(() => deleteBtnRef.current?.focus());
                }}
              >
                Keep
              </button>
            </span>
          )}
          <label className="sl-field">
            <span className="sl-field__label">Name</span>
            <span className="sl-field__control">
              <input
                className="sl-field__input"
                value={schedule.name}
                disabled={running}
                aria-invalid={nameProblem ? true : undefined}
                onChange={(e) => edit({ ...schedule, name: e.target.value })}
                onBlur={flush}
              />
            </span>
            {nameProblem && <span className="spexr-sched__problem">{nameProblem}</span>}
          </label>

          {bar!.reasons.length > 0 && (
            <div className="sl-callout sl-callout--warning spexr-sched__reasons">
              <ul>
                {bar!.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="spexr-sched__runbar" ref={runBarRef} tabIndex={-1}>
            <span className="sl-tag">{bar!.label}</span>
            {bar!.canPause && (
              <button
                className="sl-btn sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
                onClick={() => {
                  const scheduleId = schedule.id;
                  void p.onPause(scheduleId).then((problems) => setRunProblems({ scheduleId, problems }));
                }}
                title="No new task starts and no follow-up is pasted until you resume"
              >
                <i className="codicon codicon-debug-pause" aria-hidden="true" /> Pause
              </button>
            )}
            {bar!.canResume && (
              <button
                className="sl-btn sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
                onClick={() => {
                  const scheduleId = schedule.id;
                  void p.onResume(scheduleId).then((problems) => setRunProblems({ scheduleId, problems }));
                }}
                title="Pastes the held follow-up and lets the run continue"
              >
                <i className="codicon codicon-debug-continue" aria-hidden="true" /> Resume
              </button>
            )}
            {bar!.canAbort ? (
              confirmAbort ? (
                <span className="spexr-sched__confirm">
                  Stop starting tasks? Sessions stay open.
                  <button
                    className="sl-btn sl-btn--danger sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
                    onClick={() => {
                      p.onAbort(schedule.id);
                      setConfirmAbort(false);
                      // Prefers the plain Abort button once it re-mounts
                      // (Run stays disabled until the run actually ends).
                      if (canRequestFocus()) setFocusTarget({ kind: "run-bar", scheduleId: schedule.id });
                    }}
                  >
                    Abort
                  </button>
                  <button
                    ref={abortKeepBtnRef}
                    className="sl-btn sl-btn--ghost sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
                    onClick={() => {
                      setConfirmAbort(false);
                      requestAnimationFrame(() => abortBtnRef.current?.focus());
                    }}
                  >
                    Keep running
                  </button>
                </span>
              ) : (
                <button
                  ref={abortBtnRef}
                  className="sl-btn sl-btn--danger sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
                  onClick={() => {
                    setConfirmAbort(true);
                    requestAnimationFrame(() => abortKeepBtnRef.current?.focus());
                  }}
                >
                  Abort
                </button>
              )
            ) : (
              <button
                ref={runBtnRef}
                className="sl-btn sl-btn--primary sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
                disabled={!bar!.canRun}
                onClick={() => {
                  flush();
                  const scheduleId = schedule.id;
                  void p.onRun(schedule).then((problems) => setRunProblems({ scheduleId, problems }));
                }}
              >
                Run
              </button>
            )}
          </div>

          {schedule.tasks.length === 0 ? (
            <div className="sl-empty">
              <p>No tasks yet. A task is one agent session, with its own folder and prompt.</p>
              <button ref={addTaskBtnRef} className="sl-btn sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press" onClick={addTask}>
                <i className="codicon codicon-add" aria-hidden="true" /> Add a task
              </button>
            </div>
          ) : (
            <ol className="spexr-sched__bands" aria-label="Tasks, in the order they start">
              {bandsOf(rows).map((band) => (
                <li key={band.layer} className="spexr-sched__band">
                  <span className="sl-eyebrow">{band.layer === 0 ? "Starts first" : `Then, step ${band.layer + 1}`}</span>
                  <ol className="sl-list spexr-sched__tasks">
                    {band.rows.map((row) => (
                      <li
                        key={row.id}
                        className="spexr-sched__row"
                        data-layer={row.layer}
                        data-tone={row.tone}
                        data-upstream={upstream.has(row.id) ? "true" : undefined}
                      >
                        <button
                          ref={(el) => {
                            if (el) rowBtnRefs.current.set(row.id, el);
                            else rowBtnRefs.current.delete(row.id);
                          }}
                          type="button"
                          className="sl-list__row spexr-sched__rowmain"
                          aria-current={selected === row.id ? "true" : undefined}
                          onClick={() => {
                            setSelected(row.id);
                            if (running) p.onFocusTask(schedule.id, row.id);
                            else setEditing(row.id);
                          }}
                        >
                          <span className="spexr-sched__name">{row.name}</span>
                          <span className="sl-tag sl-tag--plain">{row.harness}</span>
                          <span className="sl-tag sl-tag--plain">{row.workspace}</span>
                          <span
                            className={`sl-badge${row.tone !== "neutral" ? ` sl-badge--${row.tone}` : ""}${row.status === "running" ? " sl-badge--live" : ""}`}
                          >
                            <i className={`codicon ${row.icon}`} aria-hidden="true" /> {row.label}
                            {row.iteration ? ` · ${row.iteration}` : ""}
                          </span>
                          {upstream.has(row.id) && (
                            <span className="sl-tag">
                              <i className="codicon codicon-arrow-up" aria-hidden="true" /> Upstream
                            </span>
                          )}
                          {row.unattended && (
                            <span className="sl-badge sl-badge--warning" title="Tools run without asking">
                              <i className="codicon codicon-warning" aria-hidden="true" /> Unattended
                            </span>
                          )}
                          {row.waitsFor.length > 0 && <span className="spexr-sched__waits">after {row.waitsFor.join(", ")}</span>}
                          {row.session && <span className="spexr-sched__waits spexr-sched__mono">session {row.session}</span>}
                          {row.error && <span className="spexr-sched__error">{row.error}</span>}
                        </button>
                        <span className="spexr-sched__rowactions">
                          {row.canRetry && (
                            <>
                              <button
                                className="sl-btn sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
                                onClick={() => taskAction(p.onRetry, row.id)}
                                disabled={pendingTasks.has(pendingKey(schedule.id, row.id))}
                                aria-label={`Retry ${row.name}`}
                                title="Start it again from iteration 1 in the same workspace. Its failed session is closed."
                              >
                                <i className="codicon codicon-debug-restart" aria-hidden="true" /> Retry
                              </button>
                              <button
                                className="sl-btn sl-btn--ghost sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
                                onClick={() => taskAction(p.onSkip, row.id)}
                                disabled={pendingTasks.has(pendingKey(schedule.id, row.id))}
                                aria-label={`Skip ${row.name}`}
                                title="Let the tasks that wait for it start without it. Its hand-offs arrive empty; its session stays open."
                              >
                                <i className="codicon codicon-debug-step-over" aria-hidden="true" /> Skip
                              </button>
                            </>
                          )}
                          {!running && (
                            <button
                              className="sl-icon-btn sl-fx-glass sl-fx-glass--pane sl-fx-press"
                              onClick={() => setEditing(editing === row.id ? undefined : row.id)}
                              aria-label={`Edit ${row.name}`}
                              aria-expanded={editing === row.id}
                            >
                              <i className="codicon codicon-edit" />
                            </button>
                          )}
                        </span>
                        {editing === row.id && !running && (
                          <TaskEditor
                            task={schedule.tasks.find((t) => t.id === row.id)!}
                            schedule={schedule}
                            projects={p.projects}
                            configs={p.configs}
                            problems={problems.filter((x) => x.task === row.id)}
                            onChange={updateTask}
                            onBlur={flush}
                            onRemove={() => removeTask(row.id)}
                          />
                        )}
                      </li>
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
          )}
          {!running && schedule.tasks.length > 0 && (
            <button ref={addTaskBtnRef} className="sl-btn sl-btn--ghost sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press" onClick={addTask}>
              <i className="codicon codicon-add" aria-hidden="true" /> Add a task
            </button>
          )}
        </>
      )}
      <span className="spexr-sched__sr" aria-live="polite">
        {announce}
      </span>
    </aside>
  );
}

function TaskEditor(p: {
  task: ScheduleTask;
  schedule: Schedule;
  projects: readonly { path: string; name: string }[];
  configs: readonly ClaudeConfigDir[];
  problems: ValidationProblem[];
  onChange(task: ScheduleTask): void;
  onBlur(): void;
  onRemove(): void;
}): React.ReactElement {
  const t = p.task;
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const removeBtnRef = React.useRef<HTMLButtonElement | null>(null);
  const removeKeepBtnRef = React.useRef<HTMLButtonElement | null>(null);
  // The last loop settings seen while `t.loop` was set, so switching the loop
  // off and back on restores what the operator typed instead of the defaults.
  const lastLoopRef = React.useRef<TaskLoop | undefined>(t.loop);
  React.useEffect(() => {
    if (t.loop) lastLoopRef.current = t.loop;
  }, [t.loop]);
  const problem = (field: string): string | undefined =>
    p.problems.find((x) => x.field === field)?.message;
  const set = (patch: Partial<ScheduleTask>): void => p.onChange({ ...t, ...patch });
  const promptRef = React.useRef<HTMLTextAreaElement | null>(null);
  // Whether the prompt field has ever had focus: an untouched textarea
  // reports its selection as 0..0, which would put a hand-off at the start
  // of the prompt instead of the end, where the operator is about to type.
  const promptFocusedRef = React.useRef(false);
  const handOffs = placeholderChoices(p.schedule, t.id);
  const needs = needChoices(p.schedule, t.id);
  const current = workspaceValue(t.workspace);
  const workspaces = workspaceOptions(p.schedule, t.id);
  // A sameAs left pointing at a task this one no longer waits for stays visible; validation flags it next to the field.
  const stale = staleWorkspaceOption(p.schedule, current);
  if (stale && !workspaces.some((o) => o.value === current)) workspaces.push(stale);
  const unattended = isUnattended(t.harness, t.permissionMode);
  const permWarningId = `${t.id}-perm-warning`;
  /** Insert a hand-off at the caret (R23: buttons, so arrowing never inserts), then put the caret after it. */
  const insertHandOff = (token: string): void => {
    const el = promptRef.current;
    const { start, end } = handOffRange(t.prompt.length, promptFocusedRef.current, el?.selectionStart ?? 0, el?.selectionEnd ?? 0);
    const { text, caret } = insertAt(t.prompt, start, end, token);
    set({ prompt: text });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };
  // exactOptionalPropertyTypes rejects an explicit `undefined` for an optional
  // string field (`model?`/`permissionMode?`), so clearing one drops the key
  // by destructuring instead of assigning it, the way `renamedTile` does in
  // the wall widget.
  const setOrClear = (key: "model" | "permissionMode", value: string): void => {
    if (!value) {
      const { [key]: _dropped, ...rest } = t;
      p.onChange(rest);
      return;
    }
    if (key === "model") set({ model: value });
    else set({ permissionMode: value });
  };
  /** The invalid state a field's control carries: the kit draws its edge, focus ring and halo in the danger. */
  const invalid = (field: string): true | undefined => (problem(field) ? true : undefined);
  const field = (label: string, name: string, control: React.ReactNode): React.ReactElement => (
    <label className="sl-field">
      <span className="sl-field__label">{label}</span>
      <span className="sl-field__control">{control}</span>
      {problem(name) && <span className="spexr-sched__problem">{problem(name)}</span>}
    </label>
  );
  return (
    <div className="spexr-sched__editor" onBlur={p.onBlur}>
      {field(
        "Name",
        "name",
        <input
          className="sl-field__input"
          aria-invalid={invalid("name")}
          value={t.name}
          onChange={(e) => set({ name: e.target.value })}
        />,
      )}
      {field(
        "Project",
        "project",
        <span className="sl-select">
          <select
            className="sl-field__input"
            aria-invalid={invalid("project")}
            value={t.project}
            onChange={(e) => set({ project: e.target.value })}
          >
            {/* The task's own folder may not be among the wall's current targets
                (no sessions there yet, or it left tiles/recents after a reload);
                without this, the select would silently show the first option
                while the stored value stayed the one nobody sees. */}
            {!p.projects.some((x) => x.path === t.project) && (
              <option value={t.project}>{t.project || "Pick a project…"}</option>
            )}
            {p.projects.map((x) => (
              <option key={x.path} value={x.path}>
                {x.name}
              </option>
            ))}
          </select>
        </span>,
      )}
      {field(
        "Workspace",
        "workspace",
        <span className="sl-select">
          <select className="sl-field__input" aria-invalid={invalid("workspace")} value={current} onChange={(e) => p.onChange(withWorkspace(t, e.target.value))}>
            {workspaces.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </span>,
      )}
      {t.workspace.kind === "worktree" && (
        <p className="spexr-sched__hint">
          A new folder next to the repository, on branch <code className="spexr-sched__mono">spexr/{p.schedule.id}/{t.id}</code>,
          made from the project's last commit: uncommitted changes stay behind. It is kept after the run for you to review
          and merge.
          {t.harness === "claude" &&
            " Claude asks once whether to trust a new folder: the task shows Needs you until you choose “Yes” in its card. Its default answer ends the session."}
        </p>
      )}
      {field(
        "Harness",
        "harness",
        <span className="sl-select">
          <select
            className="sl-field__input"
            aria-invalid={invalid("harness")}
            value={t.harness}
            onChange={(e) => {
              const { permissionMode: _dropped, ...rest } = t;
              p.onChange({ ...rest, harness: e.target.value as HarnessId });
            }}
          >
            <option value="claude">claude</option>
            <option value="opencode">opencode</option>
          </select>
        </span>,
      )}
      {t.harness === "claude" &&
        field(
          "Account",
          "configDir",
          <span className="sl-select">
            <select className="sl-field__input" aria-invalid={invalid("configDir")} value={t.configDir ?? ""} onChange={(e) => p.onChange(withAccount(t, e.target.value))}>
              {accountOptions(p.configs, t.configDir).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </span>,
        )}
      {field(
        "Prompt",
        "prompt",
        <textarea
          ref={promptRef}
          className="sl-field__input spexr-sched__prompt"
          aria-invalid={invalid("prompt")}
          rows={5}
          value={t.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
          onFocus={() => {
            promptFocusedRef.current = true;
          }}
        />,
      )}
      {handOffs.length > 0 ? (
        <div className="spexr-sched__handoff" role="group" aria-label="Insert a hand-off into the prompt">
          <span className="spexr-sched__hint">Insert:</span>
          {handOffs.map((h) => (
            <button key={h.token} type="button" className="sl-btn sl-btn--ghost sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press" onClick={() => insertHandOff(h.token)} title={h.token}>
              <span>{h.label}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="spexr-sched__hint">Once this task waits for another, you can hand it that task's reply or folder.</p>
      )}
      <label className="sl-switch spexr-sched__loop-switch">
        <input
          type="checkbox"
          role="switch"
          className="sl-switch__input"
          checked={!!t.loop}
          onChange={(e) => p.onChange(withLoop(t, e.target.checked, lastLoopRef.current))}
        />
        <span className="sl-switch__track" aria-hidden="true" />
        <span className="sl-switch__label">Loop until converged</span>
      </label>
      {t.loop && (
        <fieldset className="spexr-sched__loop">
          <legend className="spexr-sched__sr">Loop settings</legend>
          {field(
            "Stop criteria",
            "loop.stopCriteria",
            <textarea
              className="sl-field__input"
              aria-invalid={invalid("loop.stopCriteria")}
              rows={3}
              value={t.loop.stopCriteria}
              placeholder="All tests pass and the linter is clean."
              onChange={(e) => p.onChange(patchLoop(t, { stopCriteria: e.target.value }))}
            />,
          )}
          {field(
            "Follow-up, pasted on every new iteration",
            "loop.followUp",
            <textarea
              className="sl-field__input"
              aria-invalid={invalid("loop.followUp")}
              rows={3}
              value={t.loop.followUp}
              onChange={(e) => p.onChange(patchLoop(t, { followUp: e.target.value }))}
            />,
          )}
          {field(
            "Max iterations",
            "loop.maxIterations",
            <input
              className="sl-field__input"
              aria-invalid={invalid("loop.maxIterations")}
              type="number"
              min={1}
              max={MAX_ITERATIONS}
              value={t.loop.maxIterations}
              onChange={(e) => p.onChange(withMaxIterations(t, e.target.value))}
            />,
          )}
          {field(
            "Check command (optional)",
            "loop.check",
            <input
              className="sl-field__input spexr-sched__mono"
              aria-invalid={invalid("loop.check")}
              value={t.loop.check ?? ""}
              placeholder="pnpm test"
              aria-describedby={`${t.id}-loop-check-hint`}
              onChange={(e) => p.onChange(withCheck(t, e.target.value))}
            />,
          )}
          <p className="spexr-sched__hint" id={`${t.id}-loop-check-hint`}>
            Runs in the task's folder after a reply that ends with CONVERGED, one check at a time across all runs. If
            it fails, its last 40 lines go into the next follow-up. It runs in a login shell without your .zshrc:
            give full paths, or start with <code className="spexr-sched__mono">source ~/.zshrc &amp;&amp;</code>.
            Placeholders are not filled in here.
          </p>
          {t.loop.check !== undefined &&
            field(
              "Check timeout (seconds)",
              "loop.checkTimeoutSec",
              <input
                className="sl-field__input"
                aria-invalid={invalid("loop.checkTimeoutSec")}
                type="number"
                min={1}
                max={MAX_CHECK_TIMEOUT_SEC}
                value={t.loop.checkTimeoutSec ?? ""}
                placeholder={String(DEFAULT_CHECK_TIMEOUT_SEC)}
                onChange={(e) => p.onChange(withCheckTimeout(t, e.target.value))}
              />,
            )}
          {t.harness === "opencode" && (
            <p className="spexr-sched__hint">
              opencode turn ends are read from the wall's scan, so each iteration can start up to about 20 seconds late.
            </p>
          )}
        </fieldset>
      )}
      <fieldset className="spexr-sched__needs" data-invalid={problem("needs") ? "true" : undefined}>
        <legend className="sl-field__label">Waits for</legend>
        {needs.length === 0 ? (
          <p className="spexr-sched__hint">Add another task to make this one wait for it.</p>
        ) : (
          needs.map((n) => (
            <div key={n.id} className="spexr-sched__need">
              <label className="sl-check">
                <input
                  type="checkbox"
                  className="sl-check__input"
                  checked={n.checked}
                  aria-disabled={n.blockedBy ? true : undefined}
                  aria-describedby={n.blockedBy ? `${t.id}-need-${n.id}-why` : undefined}
                  onChange={(e) => {
                    // aria-disabled, not disabled: a disabled input leaves the
                    // tab order, which would make its reason unreachable by
                    // keyboard (AC-17). It stays focusable and just ignores
                    // the change; the controlled `checked` reverts it.
                    if (n.blockedBy) return;
                    p.onChange(withNeed(t, n.id, e.target.checked));
                  }}
                />
                <span className="sl-check__box" aria-hidden="true" />
                <span className="sl-check__label">{n.name}</span>
              </label>
              {/* Outside the .sl-check row: the dimming rule below targets aria-disabled specifically, not the row generally. */}
              {n.blockedBy && (
                <span className="spexr-sched__hint" id={`${t.id}-need-${n.id}-why`}>
                  {n.blockedBy}
                </span>
              )}
            </div>
          ))
        )}
        {problem("needs") && <span className="spexr-sched__problem">{problem("needs")}</span>}
      </fieldset>
      <details className="spexr-sched__advanced">
        <summary>
          Model and permissions
          {unattended && (
            <span className="sl-badge sl-badge--warning spexr-sched__advanced-badge" title="This mode approves tools without asking">
              <i className="codicon codicon-warning" aria-hidden="true" /> Unattended
            </span>
          )}
        </summary>
        {field(
          "Model",
          "model",
          <input
            className="sl-field__input"
            aria-invalid={invalid("model")}
            value={t.model ?? ""}
            placeholder="default"
            onChange={(e) => setOrClear("model", e.target.value)}
          />,
        )}
        {field(
          "Permission mode",
          "permissionMode",
          <span className="sl-select">
            <select
              className="sl-field__input"
              aria-invalid={invalid("permissionMode")}
              value={t.permissionMode ?? ""}
              aria-describedby={unattended ? permWarningId : undefined}
              onChange={(e) => setOrClear("permissionMode", e.target.value)}
            >
              <option value="">ask (default)</option>
              {PERMISSION_MODES[t.harness].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </span>,
        )}
        {unattended && (
          <div className="sl-callout sl-callout--warning spexr-sched__perm-warning" id={permWarningId}>
            <i className="codicon codicon-warning" aria-hidden="true" /> This mode approves tools without asking: the
            session will edit and run commands without stopping for you.
          </div>
        )}
      </details>
      <div className="spexr-sched__editor-actions">
        {confirmRemove ? (
          <span className="spexr-sched__confirm" role="group" aria-label="Confirm remove task">
            Remove “{t.name}”?
            <button className="sl-btn sl-btn--danger sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press" onClick={p.onRemove}>
              Remove
            </button>
            <button
              ref={removeKeepBtnRef}
              className="sl-btn sl-btn--ghost sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
              onClick={() => {
                setConfirmRemove(false);
                requestAnimationFrame(() => removeBtnRef.current?.focus());
              }}
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            ref={removeBtnRef}
            className="sl-btn sl-btn--ghost sl-btn--danger sl-btn--sm sl-fx-glass sl-fx-glass--pane sl-fx-press"
            onClick={() => {
              setConfirmRemove(true);
              requestAnimationFrame(() => removeKeepBtnRef.current?.focus());
            }}
            title="Remove this task. Tasks that wait for it stop waiting; one that shared its workspace uses the project folder."
          >
            <i className="codicon codicon-trash" aria-hidden="true" /> Remove task
          </button>
        )}
      </div>
    </div>
  );
}
