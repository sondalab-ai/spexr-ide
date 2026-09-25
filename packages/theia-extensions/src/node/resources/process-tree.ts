import type { ResourceGroup, ResourceUsage } from "../../common/resource-protocol.js";

/** `ps` arguments for every process; `args` goes last because it holds spaces. */
export const PS_ARGS = ["-A", "-o", "pid=,ppid=,rss=,time=,args="];

export interface ProcessRow {
  readonly pid: number;
  readonly ppid: number;
  readonly rssBytes: number;
  /** CPU time used over the process's lifetime. */
  readonly cpuSeconds: number;
  readonly args: string;
}

/** The forked model workers, recognised by their script (see models-dir.ts). */
const MODEL_WORKER = /[\\/](description|decision)-worker\.js\b/;

/** Theia's own helpers under the backend (file watcher, plugin host): part of the app. */
const THEIA_HELPER = /[\\/]@theia[\\/]/;

/**
 * Seconds from a `ps` cumulative CPU time: `[dd-][hh:]mm:ss[.ff]`. macOS
 * prints `mm:ss.ff`, Linux `[dd-]hh:mm:ss`. Anything else reads as 0.
 */
export function parseCpuTime(text: string): number {
  const m = text.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!m) return 0;
  const [, days, hours, minutes, seconds] = m;
  return Number(days ?? 0) * 86400 + Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/**
 * Rows from `ps -A -o pid=,ppid=,rss=,time=,args=`. RSS comes in KiB. Lines
 * that do not start with the numeric columns, like a header, are skipped.
 */
export function parsePs(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    rows.push({
      pid: Number(m[1]),
      ppid: Number(m[2]),
      rssBytes: Number(m[3]) * 1024,
      cpuSeconds: parseCpuTime(m[4]!),
      args: m[5]!,
    });
  }
  return rows;
}

/**
 * Sum memory and CPU over `rootPid` and its descendants, split three ways:
 * the backend's model workers, everything else under the backend (terminals
 * and agents), and the rest of the tree (the app), which includes the
 * helpers Theia forks from the backend. CPU is the time each
 * process used since `previous` (pid to CPU seconds) over `elapsedSeconds`;
 * a pid missing from `previous`, or whose time went backwards, counts 0.
 */
export function summarizeTree(
  rows: readonly ProcessRow[],
  pids: { readonly rootPid: number; readonly backendPid: number },
  previous: ReadonlyMap<number, number>,
  elapsedSeconds: number,
): ResourceUsage {
  const children = new Map<number, ProcessRow[]>();
  const byPid = new Map<number, ProcessRow>();
  for (const r of rows) {
    byPid.set(r.pid, r);
    const siblings = children.get(r.ppid);
    if (siblings) siblings.push(r);
    else children.set(r.ppid, [r]);
  }

  const app = emptyGroup();
  const models = emptyGroup();
  const terminals = emptyGroup();
  const add = (group: MutableGroup, r: ProcessRow): void => {
    const before = previous.get(r.pid);
    const used = before === undefined ? 0 : Math.max(0, r.cpuSeconds - before);
    group.rssBytes += r.rssBytes;
    group.cpuPercent += elapsedSeconds > 0 ? (used / elapsedSeconds) * 100 : 0;
    group.processes++;
  };

  // Depth-first over the tree, remembering whether we are below the backend.
  const root = byPid.get(pids.rootPid);
  const stack: Array<{ row: ProcessRow; underBackend: boolean }> = root ? [{ row: root, underBackend: false }] : [];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const { row: r, underBackend } = stack.pop()!;
    if (seen.has(r.pid)) continue;
    seen.add(r.pid);
    if (!underBackend || THEIA_HELPER.test(r.args)) add(app, r);
    else add(MODEL_WORKER.test(r.args) ? models : terminals, r);
    const below = underBackend || r.pid === pids.backendPid;
    for (const child of children.get(r.pid) ?? []) stack.push({ row: child, underBackend: below });
  }

  return { total: sumGroups(app, models, terminals), app, models, terminals };
}

type MutableGroup = { -readonly [K in keyof ResourceGroup]: ResourceGroup[K] };

function emptyGroup(): MutableGroup {
  return { rssBytes: 0, cpuPercent: 0, processes: 0 };
}

function sumGroups(...groups: ResourceGroup[]): ResourceGroup {
  const total = emptyGroup();
  for (const g of groups) {
    total.rssBytes += g.rssBytes;
    total.cpuPercent += g.cpuPercent;
    total.processes += g.processes;
  }
  return total;
}
