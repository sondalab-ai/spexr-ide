import {
  MAX_ITERATIONS,
  MAX_PROMPT_CHARS,
  MODEL_PATTERN,
  PERMISSION_MODES,
  SCHEDULE_HARNESSES,
  SCHEDULE_ID_PATTERN,
  type Schedule,
  type ScheduleTask,
  type ValidationProblem,
} from "./schedule-types.js";
import { findCycle, mayRunTogether, staticFolder, upstreamOf } from "./schedule-graph.js";
import { placeholdersIn } from "./schedule-prompt.js";

/**
 * Every problem that keeps a schedule from running, each naming the task and
 * field it concerns. A cycle stops the checks that walk the graph: with one
 * present, "upstream" has no meaning.
 */
export function validateSchedule(s: Schedule): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const add = (task: string | undefined, field: string, message: string): void => {
    problems.push(task === undefined ? { field, message } : { task, field, message });
  };
  if (!SCHEDULE_ID_PATTERN.test(s.id)) add(undefined, "id", "Use 1–32 lowercase letters, digits or dashes.");
  if (!s.name.trim()) add(undefined, "name", "Give the schedule a name.");
  if (s.tasks.length === 0) add(undefined, "tasks", "Add at least one task.");

  const seen = new Set<string>();
  for (const t of s.tasks) {
    if (!SCHEDULE_ID_PATTERN.test(t.id)) add(t.id, "id", "Use 1–32 lowercase letters, digits or dashes.");
    else if (seen.has(t.id)) add(t.id, "id", "Another task already uses this id.");
    seen.add(t.id);
  }
  for (const t of s.tasks) checkTask(t, seen, add);

  const cycle = findCycle(s);
  if (cycle) {
    add(cycle[0], "needs", `These tasks wait for each other: ${cycle.join(" → ")}.`);
    return problems;
  }

  // Only proceed with graph-dependent checks if all task ids are valid and unique
  const hasIdProblems = problems.some((p) => p.field === "id");
  if (!hasIdProblems) {
    for (const t of s.tasks) {
      const upstream = upstreamOf(s, t.id);
      if (t.workspace.kind === "sameAs" && seen.has(t.workspace.task) && !upstream.has(t.workspace.task)) {
        add(t.id, "workspace", `It can only share the workspace of a task it waits for.`);
      }
      const stray = placeholdersIn(t.prompt).filter((p) => !upstream.has(p.task));
      if (stray.length > 0) {
        add(t.id, "prompt", `Placeholders can only name tasks this one waits for: ${[...new Set(stray.map((p) => p.task))].join(", ")}.`);
      }
    }
    checkSharedFolders(s, add);
  }
  return problems;
}

function checkTask(
  t: ScheduleTask,
  ids: Set<string>,
  add: (task: string, field: string, message: string) => void,
): void {
  const unknown = t.needs.filter((n) => !ids.has(n));
  if (unknown.length > 0) add(t.id, "needs", `Unknown tasks: ${unknown.join(", ")}.`);
  else if (t.needs.includes(t.id)) add(t.id, "needs", "A task cannot wait for itself.");
  if (t.workspace.kind === "sameAs" && !ids.has(t.workspace.task)) {
    add(t.id, "workspace", `Unknown task: ${t.workspace.task}.`);
  }
  if (!t.project.startsWith("/")) add(t.id, "project", "Pick a project folder.");
  if (!SCHEDULE_HARNESSES.includes(t.harness)) {
    add(t.id, "harness", `Unknown harness: ${String(t.harness)}.`);
    return;
  }
  if (t.permissionMode && !PERMISSION_MODES[t.harness].includes(t.permissionMode)) {
    add(t.id, "permissionMode", `${t.harness} offers: ${PERMISSION_MODES[t.harness].join(", ")}.`);
  }
  if (t.model && !MODEL_PATTERN.test(t.model)) add(t.id, "model", "Not a model name.");
  const prompt = t.prompt.trim();
  if (!prompt) add(t.id, "prompt", "Write the prompt.");
  else if (t.prompt.length > MAX_PROMPT_CHARS) add(t.id, "prompt", `Keep it under ${MAX_PROMPT_CHARS} characters.`);
  else if (prompt.startsWith("-")) add(t.id, "prompt", 'It cannot start with "-": the harness would read it as an option.');
  if (t.loop) {
    const { maxIterations, stopCriteria, followUp } = t.loop;
    if (!Number.isInteger(maxIterations) || maxIterations < 1 || maxIterations > MAX_ITERATIONS) {
      add(t.id, "loop.maxIterations", `Between 1 and ${MAX_ITERATIONS}.`);
    }
    if (!stopCriteria.trim()) add(t.id, "loop.stopCriteria", "Say when the task is done.");
    if (!followUp.trim()) add(t.id, "loop.followUp", "Write what to send on each new iteration.");
  }
}

/** Tasks that may run together must not resolve to one folder: the wall tells sessions apart by folder. */
function checkSharedFolders(s: Schedule, add: (task: string, field: string, message: string) => void): void {
  const flagged = new Set<string>();
  for (let i = 0; i < s.tasks.length; i++) {
    for (let j = i + 1; j < s.tasks.length; j++) {
      const a = s.tasks[i]!;
      const b = s.tasks[j]!;
      if (flagged.has(b.id)) continue;
      if (staticFolder(s, a.id) !== staticFolder(s, b.id) || !mayRunTogether(s, a.id, b.id)) continue;
      add(b.id, "workspace", `It may run at the same time as "${a.name}" in the same folder. Give one a worktree, or make one wait for the other.`);
      flagged.add(b.id);
    }
  }
}
