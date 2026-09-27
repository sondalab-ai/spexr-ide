import * as React from "@theia/core/shared/react";
import type { HarnessId } from "../../../common/harness/harness-types.js";
import type { ScheduleSnapshot } from "../../../common/schedule/schedule-protocol.js";
import {
  PERMISSION_MODES,
  type Schedule,
  type ScheduleTask,
  type ValidationProblem,
} from "../../../common/schedule/schedule-types.js";
import { validateSchedule } from "../../../common/schedule/schedule-validate.js";
import { newSchedule, newTask, runBar, taskRows, taskTransitions, type TaskRow } from "./schedule-view.js";

export interface ScheduleSidebarProps {
  snapshot: ScheduleSnapshot;
  projects: readonly { path: string; name: string }[];
  width: number;
  onSave(schedule: Schedule): void;
  onRemove(scheduleId: string): void;
  /** Resolves to the problems that refused the run (empty on success), so they can join the reasons above Run. */
  onRun(schedule: Schedule): Promise<ValidationProblem[]>;
  onAbort(scheduleId: string): void;
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
  // What the backend refused the last Run for; cleared by the next edit or a
  // run that started cleanly, so a stale refusal never outlives its cause.
  const [runProblems, setRunProblems] = React.useState<ValidationProblem[]>([]);
  const edit = (next: Schedule): void => {
    setRunProblems([]);
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
  const problems: ValidationProblem[] = schedule ? [...validateSchedule(schedule), ...runProblems] : [];
  const bar = schedule ? runBar(schedule, run, problems) : undefined;
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
    setRunProblems([]);
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
    setRunProblems([]);
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
                      setRunProblems([]);
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
          <label className="sl-field">
            <span className="sl-field__label">Name</span>
            <span className="sl-field__control">
              <input
                className="sl-field__input"
                value={schedule.name}
                disabled={running}
                onChange={(e) => edit({ ...schedule, name: e.target.value })}
                onBlur={flush}
              />
            </span>
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
                  void p.onRun(schedule).then((problems) => setRunProblems(problems));
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
                    projects={p.projects}
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
  projects: readonly { path: string; name: string }[];
  problems: ValidationProblem[];
  onChange(task: ScheduleTask): void;
  onBlur(): void;
}): React.ReactElement {
  const t = p.task;
  const problem = (field: string): string | undefined =>
    p.problems.find((x) => x.field === field)?.message;
  const set = (patch: Partial<ScheduleTask>): void => p.onChange({ ...t, ...patch });
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
      {field(
        "Prompt",
        "prompt",
        <textarea
          className="sl-field__input spexr-sched__prompt"
          rows={5}
          value={t.prompt}
          onChange={(e) => set({ prompt: e.target.value })}
        />,
      )}
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
