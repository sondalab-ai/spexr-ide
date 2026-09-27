import type { Schedule, ScheduleTask } from "./schedule-types.js";

function byId(s: Schedule): Map<string, ScheduleTask> {
  return new Map(s.tasks.map((t) => [t.id, t]));
}

/**
 * Every task `id` waits for, directly or through others. Unknown ids are
 * skipped; on a cycle the walk still ends (a task can then be its own upstream).
 */
export function upstreamOf(s: Schedule, id: string): Set<string> {
  const tasks = byId(s);
  const seen = new Set<string>();
  const stack = [...(tasks.get(id)?.needs ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (seen.has(next) || !tasks.has(next)) continue;
    seen.add(next);
    stack.push(...tasks.get(next)!.needs);
  }
  return seen;
}

/**
 * One cycle in the `needs` graph as a closed path (`[a, b, a]`), or undefined.
 * Depth-first search with three colours; unknown ids are ignored.
 */
export function findCycle(s: Schedule): string[] | undefined {
  const tasks = byId(s);
  const colour = new Map<string, "grey" | "black">();
  const path: string[] = [];
  const visit = (id: string): string[] | undefined => {
    colour.set(id, "grey");
    path.push(id);
    for (const dep of tasks.get(id)?.needs ?? []) {
      if (!tasks.has(dep)) continue;
      if (colour.get(dep) === "grey") return [...path.slice(path.indexOf(dep)), dep];
      if (!colour.has(dep)) {
        const found = visit(dep);
        if (found) return found;
      }
    }
    path.pop();
    colour.set(id, "black");
    return undefined;
  };
  for (const t of s.tasks) {
    if (colour.has(t.id)) continue;
    const found = visit(t.id);
    if (found) return found;
  }
  return undefined;
}

/** True when neither task waits for the other, so a run may have both going at once. */
export function mayRunTogether(s: Schedule, a: string, b: string): boolean {
  return !upstreamOf(s, a).has(b) && !upstreamOf(s, b).has(a);
}

/**
 * Tasks grouped by depth: a task with no needs is at depth 0, any other one
 * level below its deepest upstream task. Assumes an acyclic graph.
 */
export function layersOf(s: Schedule): string[][] {
  const tasks = byId(s);
  const depth = new Map<string, number>();
  const depthOf = (id: string): number => {
    const known = depth.get(id);
    if (known !== undefined) return known;
    const needs = (tasks.get(id)?.needs ?? []).filter((n) => tasks.has(n));
    const d = needs.length === 0 ? 0 : 1 + Math.max(...needs.map(depthOf));
    depth.set(id, d);
    return d;
  };
  const layers: string[][] = [];
  for (const t of s.tasks) (layers[depthOf(t.id)] ??= []).push(t.id);
  return layers.filter(Boolean);
}

/**
 * The folder a task works in, as far as it is known before a run: the project
 * for `folder`, a token unique to the task for `worktree` (its path is only
 * made at start), and the target's folder for `sameAs`. Used to keep tasks that
 * may run together out of each other's folder.
 */
export function staticFolder(s: Schedule, id: string, hops = 0): string {
  const t = byId(s).get(id);
  if (!t || hops > s.tasks.length) return `unresolved:${id}`;
  switch (t.workspace.kind) {
    case "folder":
      return t.project.replace(/\/+$/, "") || t.project;
    case "worktree":
      return `worktree:${t.id}`;
    case "sameAs":
      return staticFolder(s, t.workspace.task, hops + 1);
  }
}
