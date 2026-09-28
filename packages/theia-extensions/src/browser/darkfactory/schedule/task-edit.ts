import type { ClaudeConfigDir } from "../../../common/darkfactory-protocol.js";
import type { Schedule, ScheduleTask, TaskWorkspace } from "../../../common/schedule/schedule-types.js";
import { upstreamOf } from "../../../common/schedule/schedule-graph.js";

export interface Choice {
  value: string;
  label: string;
}

export interface NeedChoice {
  id: string;
  name: string;
  checked: boolean;
  /** Why it cannot be chosen: that task already waits for this one, so choosing it would close a cycle (R23). */
  blockedBy?: string;
}

/** The other tasks this one may wait for; a task downstream of it is offered but blocked, with why. */
export function needChoices(schedule: Schedule, taskId: string): NeedChoice[] {
  const task = schedule.tasks.find((x) => x.id === taskId);
  return schedule.tasks
    .filter((x) => x.id !== taskId)
    .map((x) => {
      const checked = task?.needs.includes(x.id) ?? false;
      const downstream = !checked && upstreamOf(schedule, x.id).has(taskId);
      return { id: x.id, name: x.name, checked, ...(downstream ? { blockedBy: `${x.name} already waits for this task.` } : {}) };
    });
}

/** Add or remove one "waits for" link. */
export function withNeed(task: ScheduleTask, id: string, on: boolean): ScheduleTask {
  if (on) return task.needs.includes(id) ? task : { ...task, needs: [...task.needs, id] };
  return { ...task, needs: task.needs.filter((x) => x !== id) };
}

/** The project folder, a new worktree, or the workspace of a task this one waits for — never of any other (spec, Sidebar). */
export function workspaceOptions(schedule: Schedule, taskId: string): Choice[] {
  const up = upstreamOf(schedule, taskId);
  return [
    { value: "folder", label: "Project folder" },
    { value: "worktree", label: "New worktree" },
    ...schedule.tasks.filter((x) => up.has(x.id)).map((x) => ({ value: `sameAs:${x.id}`, label: `Same as ${x.name}` })),
  ];
}

export function workspaceValue(ws: TaskWorkspace): string {
  return ws.kind === "sameAs" ? `sameAs:${ws.task}` : ws.kind;
}

/**
 * The extra option to show when a task's stored workspace choice fell out of
 * `workspaceOptions` (it no longer waits for that task): named when the
 * target still exists in the schedule ("not waited for"), or flagged as
 * unknown when it was deleted. `undefined` for a value `workspaceOptions`
 * already offers.
 */
export function staleWorkspaceOption(schedule: Schedule, value: string): Choice | undefined {
  if (!value.startsWith("sameAs:")) return undefined;
  const id = value.slice("sameAs:".length);
  const target = schedule.tasks.find((x) => x.id === id);
  return { value, label: target ? `Same as ${target.name} (not waited for)` : `Unknown task: ${id}` };
}

export function withWorkspace(task: ScheduleTask, value: string): ScheduleTask {
  const workspace: TaskWorkspace =
    value === "worktree"
      ? { kind: "worktree" }
      : value.startsWith("sameAs:")
        ? { kind: "sameAs", task: value.slice("sameAs:".length) }
        : { kind: "folder" };
  return { ...task, workspace };
}

/** The hand-offs a prompt may use: each upstream task's reply and folder, in schedule order (spec, Hand-off). */
export function placeholderChoices(schedule: Schedule, taskId: string): { token: string; label: string }[] {
  const up = upstreamOf(schedule, taskId);
  return schedule.tasks
    .filter((x) => up.has(x.id))
    .flatMap((x) => [
      { token: `{{${x.id}.reply}}`, label: `${x.name}: final reply` },
      { token: `{{${x.id}.workspace}}`, label: `${x.name}: folder` },
    ]);
}

/**
 * Where a hand-off should land: at the real caret once the prompt field has
 * been focused, or at the end of its text otherwise. An untouched textarea
 * reports its selection as 0..0, which would insert at the start instead of
 * where the operator is about to keep typing.
 */
export function handOffRange(
  textLength: number,
  focused: boolean,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } {
  return focused ? { start: selectionStart, end: selectionEnd } : { start: textLength, end: textLength };
}

/** Put `token` in place of the selection `start..end`; returns the text and where the caret goes. */
export function insertAt(text: string, start: number, end: number, token: string): { text: string; caret: number } {
  const a = Math.max(0, Math.min(start, text.length));
  const b = Math.max(a, Math.min(end, text.length));
  return { text: text.slice(0, a) + token + text.slice(b), caret: a + token.length };
}

/** "Default account", then every account the launcher knows; a stored one no longer found stays visible. */
export function accountOptions(configs: readonly ClaudeConfigDir[], current: string | undefined): Choice[] {
  const options: Choice[] = [
    { value: "", label: "Default account" },
    ...configs.map((c) => ({ value: c.path, label: c.isDefault ? `${c.label} (default)` : c.label })),
  ];
  if (current && !configs.some((c) => c.path === current)) options.push({ value: current, label: `${current} (not found)` });
  return options;
}

/** Pick the Claude account; "" is the default and drops the key (exactOptionalPropertyTypes). */
export function withAccount(task: ScheduleTask, configDir: string): ScheduleTask {
  if (configDir) return { ...task, configDir };
  const { configDir: _dropped, ...rest } = task;
  return rest;
}

/**
 * The schedule without one task. Every link to it goes too: the others stop
 * waiting for it, and a task that shared its workspace falls back to the
 * project folder (a placeholder naming it is left for validation to flag).
 */
export function withoutTask(schedule: Schedule, taskId: string): Schedule {
  if (!schedule.tasks.some((x) => x.id === taskId)) return schedule;
  const tasks = schedule.tasks
    .filter((x) => x.id !== taskId)
    .map((x) => {
      const waits = x.needs.includes(taskId);
      const shares = x.workspace.kind === "sameAs" && x.workspace.task === taskId;
      if (!waits && !shares) return x;
      return {
        ...x,
        ...(waits ? { needs: x.needs.filter((n) => n !== taskId) } : {}),
        ...(shares ? { workspace: { kind: "folder" as const } } : {}),
      };
    });
  return { ...schedule, tasks };
}
