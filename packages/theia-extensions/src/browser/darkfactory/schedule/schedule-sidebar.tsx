import * as React from "@theia/core/shared/react";
import type { ClaudeConfigDir } from "../../../common/darkfactory-protocol.js";
import type { HarnessId } from "../../../common/harness/harness-types.js";
import type { ScheduleSnapshot } from "../../../common/schedule/schedule-protocol.js";
import {
  DEFAULT_CHECK_TIMEOUT_SEC,
  MAX_CHECK_TIMEOUT_SEC,
  MAX_ITERATIONS,
  PERMISSION_MODES,
  type Schedule,
  type ScheduleTask,
  type TaskLoop,
  type ValidationProblem,
} from "../../../common/schedule/schedule-types.js";
import { validateSchedule } from "../../../common/schedule/schedule-validate.js";
import { patchLoop, withCheck, withCheckTimeout, withLoop, withMaxIterations } from "./loop-edit.js";
import { newSchedule, newTask, runBar, taskRows, taskTransitions, type TaskRow } from "./schedule-view.js";
import {
  accountOptions,
  insertAt,
  needChoices,
  placeholderChoices,
  withAccount,
  withNeed,
  withWorkspace,
  workspaceOptions,
  workspaceValue,
} from "./task-edit.js";

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
  // Edits go to a local draft and are saved after a pause in typing: saving
  // every keystroke over RPC made controlled inputs lag and drop characters.
  const [draft, setDraft] = React.useState<Schedule | undefined>();
  // The draft object last handed to onSave (by the debounce or by flush()),
  // so a blur with nothing new to say is a no-op instead of a duplicate save.
  const savedRef = React.useRef<Schedule | undefined>(undefined);
  // React 19's useRef has no zero-argument overload, and exactOptionalPropertyTypes
  // rejects an implicit `undefined`, so the initial value is passed explicitly.
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      p.onSave(next);
      savedRef.current = next;
    }, 600);
  };
  const flush = (): void => {
    if (!draft || draft === savedRef.current) return;
    clearTimeout(saveTimer.current);
    p.onSave(draft);
    savedRef.current = draft;
  };
  React.useEffect(() => () => clearTimeout(saveTimer.current), []);
  const problems: ValidationProblem[] = schedule
    ? [...validateSchedule(schedule), ...(runProblems?.scheduleId === schedule.id ? runProblems.problems : [])]
    : [];
  const bar = schedule ? runBar(schedule, run, problems) : undefined;
  const nameProblem = problems.find((x) => !x.task && x.field === "name")?.message;
  const rows = schedule ? taskRows(schedule, run) : [];
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
    if (!running) setConfirmAbort(false);
  }, [running]);

  const addSchedule = (): void => {
    // Flush any pending edit to the schedule being left, and drop the local
    // draft: a freed id (from a delete) can be reused by newSchedule, and a
    // stale draft with that id would resurrect the deleted content over it.
    flush();
    clearTimeout(saveTimer.current);
    setDraft(undefined);
    savedRef.current = undefined;
    setRunProblems(undefined);
    const s = newSchedule(new Set(p.snapshot.schedules.map((x) => x.id)));
    p.onSave(s);
    setSelectedId(s.id);
  };
  const removeSchedule = (id: string): void => {
    if (draft?.id === id) {
      clearTimeout(saveTimer.current);
      setDraft(undefined);
      savedRef.current = undefined;
    }
    setRunProblems(undefined);
    setEditing(undefined);
    p.onRemove(id);
  };
  const updateTask = (task: ScheduleTask): void => {
    if (!schedule) return;
    edit({ ...schedule, tasks: schedule.tasks.map((t) => (t.id === task.id ? task : t)) });
  };
  const addTask = (): void => {
    if (!schedule) return;
    const t = newTask(p.projects[0]?.path ?? "", new Set(schedule.tasks.map((x) => x.id)));
    edit({ ...schedule, tasks: [...schedule.tasks, t] });
    setEditing(t.id);
  };

  return (
    <aside className="spexr-sched" style={{ width: p.width }} aria-label="Plant schedule">
      <header className="spexr-sched__head">
        <span className="sl-eyebrow">Plant schedule</span>
        <button
          className="sl-icon-btn"
          onClick={p.onClose}
          aria-label="Close the schedule"
          title="Close"
        >
          <i className="codicon codicon-layout-sidebar-right-off" />
        </button>
      </header>
      {!schedule ? (
        <div className="sl-empty spexr-sched__empty">
          <p>Lay out agent sessions, say which waits for which, and run them.</p>
          <button className="sl-btn" onClick={addSchedule}>
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
                    className="sl-field__input"
                    value={schedule.id}
                    onChange={(e) => {
                      flush();
                      clearTimeout(saveTimer.current);
                      setDraft(undefined);
                      savedRef.current = undefined;
                      setRunProblems(undefined);
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
              className="sl-icon-btn"
              onClick={addSchedule}
              aria-label="New schedule"
              title="New schedule"
            >
              <i className="codicon codicon-add" />
            </button>
            <button
              className="sl-icon-btn"
              onClick={() => removeSchedule(schedule.id)}
              disabled={running}
              aria-label="Delete this schedule"
              title="Delete this schedule"
            >
              <i className="codicon codicon-trash" />
            </button>
          </div>
          <label className="sl-field" data-invalid={nameProblem ? "true" : undefined}>
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
          <div className="spexr-sched__runbar">
            <span className="sl-tag">{bar!.label}</span>
            {bar!.canPause && (
              <button
                className="sl-btn sl-btn--sm"
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
                className="sl-btn sl-btn--sm"
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
                    className="sl-btn sl-btn--sm"
                    onClick={() => {
                      p.onAbort(schedule.id);
                      setConfirmAbort(false);
                    }}
                  >
                    Abort
                  </button>
                  <button
                    className="sl-btn sl-btn--ghost sl-btn--sm"
                    onClick={() => setConfirmAbort(false)}
                  >
                    Keep running
                  </button>
                </span>
              ) : (
                <button className="sl-btn sl-btn--sm" onClick={() => setConfirmAbort(true)}>
                  Abort
                </button>
              )
            ) : (
              <button
                className="sl-btn sl-btn--primary sl-btn--sm"
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

          <ol className="spexr-sched__tasks">
            {rows.map((row) => (
              <li
                key={row.id}
                className="spexr-sched__row"
                data-layer={row.layer}
                data-tone={row.tone}
                aria-current={editing === row.id ? "true" : undefined}
              >
                <button
                  className="spexr-sched__rowmain"
                  onClick={() =>
                    running ? p.onFocusTask(schedule.id, row.id) : setEditing(row.id)
                  }
                >
                  <span className="spexr-sched__name">{row.name}</span>
                  <span className="sl-tag sl-tag--plain">{row.harness}</span>
                  <span
                    className={`sl-badge${row.tone !== "neutral" ? ` sl-badge--${row.tone}` : ""}${row.status === "running" ? " sl-badge--live" : ""}`}
                  >
                    <i className={`codicon ${row.icon}`} aria-hidden="true" /> {row.label}
                    {row.iteration ? ` · ${row.iteration}` : ""}
                  </span>
                  {row.unattended && (
                    <span className="sl-badge sl-badge--warning" title="Tools run without asking">
                      <i className="codicon codicon-warning" aria-hidden="true" /> Unattended
                    </span>
                  )}
                  {row.waitsFor.length > 0 && (
                    <span className="spexr-sched__waits">after {row.waitsFor.join(", ")}</span>
                  )}
                  {row.error && <span className="spexr-sched__error">{row.error}</span>}
                </button>
                {!running && (
                  <button
                    className="sl-icon-btn"
                    onClick={() => setEditing(editing === row.id ? undefined : row.id)}
                    aria-label={`Edit ${row.name}`}
                  >
                    <i className="codicon codicon-edit" />
                  </button>
                )}
                {editing === row.id && !running && (
                  <TaskEditor
                    task={schedule.tasks.find((t) => t.id === row.id)!}
                    schedule={schedule}
                    projects={p.projects}
                    configs={p.configs}
                    problems={problems.filter((x) => x.task === row.id)}
                    onChange={updateTask}
                    onBlur={flush}
                  />
                )}
              </li>
            ))}
          </ol>
          {!running && (
            <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={addTask}>
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
}): React.ReactElement {
  const t = p.task;
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
  const handOffs = placeholderChoices(p.schedule, t.id);
  const needs = needChoices(p.schedule, t.id);
  const current = workspaceValue(t.workspace);
  const workspaces = workspaceOptions(p.schedule, t.id);
  // A sameAs left pointing at a task this one no longer waits for stays visible; validation flags it next to the field.
  if (!workspaces.some((o) => o.value === current)) workspaces.push({ value: current, label: "Same as a task it does not wait for" });
  /** Insert a hand-off at the caret (R23: buttons, so arrowing never inserts), then put the caret after it. */
  const insertHandOff = (token: string): void => {
    const el = promptRef.current;
    const { text, caret } = insertAt(t.prompt, el?.selectionStart ?? t.prompt.length, el?.selectionEnd ?? t.prompt.length, token);
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
  const field = (label: string, name: string, control: React.ReactNode): React.ReactElement => (
    <label className="sl-field" data-invalid={problem(name) ? "true" : undefined}>
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
          <select className="sl-field__input" value={current} onChange={(e) => p.onChange(withWorkspace(t, e.target.value))}>
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
            <select className="sl-field__input" value={t.configDir ?? ""} onChange={(e) => p.onChange(withAccount(t, e.target.value))}>
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
          rows={5}
          value={t.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
        />,
      )}
      {handOffs.length > 0 ? (
        <div className="spexr-sched__handoff" role="group" aria-label="Insert a hand-off into the prompt">
          <span className="spexr-sched__hint">Insert:</span>
          {handOffs.map((h) => (
            <button key={h.token} type="button" className="sl-btn sl-btn--ghost sl-btn--sm" onClick={() => insertHandOff(h.token)} title={h.token}>
              {h.label}
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
            <label key={n.id} className="sl-check">
              <input
                type="checkbox"
                className="sl-check__input"
                checked={n.checked}
                disabled={!!n.blockedBy}
                onChange={(e) => p.onChange(withNeed(t, n.id, e.target.checked))}
              />
              <span className="sl-check__box" aria-hidden="true" />
              <span className="sl-check__label">
                {n.name}
                {n.blockedBy && <span className="spexr-sched__hint"> — {n.blockedBy}</span>}
              </span>
            </label>
          ))
        )}
        {problem("needs") && <span className="spexr-sched__problem">{problem("needs")}</span>}
      </fieldset>
      <details className="spexr-sched__advanced">
        <summary>Model and permissions</summary>
        {field(
          "Model",
          "model",
          <input
            className="sl-field__input"
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
              value={t.permissionMode ?? ""}
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
      </details>
    </div>
  );
}
