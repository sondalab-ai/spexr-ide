import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { RunState, Schedule } from "../../common/schedule/schedule-types.js";

export interface ScheduleFile {
  version: 1;
  schedules: Schedule[];
  runs: Record<string, RunState>;
}

const empty = (): ScheduleFile => ({ version: 1, schedules: [], runs: {} });

/** `~/.spexr/schedules.json`, or `SPEXR_SCHEDULES` (tests). Global: the wall shows every project. */
export function resolveSchedulesPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["SPEXR_SCHEDULES"] ?? join(homedir(), ".spexr", "schedules.json");
}

function isScheduleFile(raw: unknown): raw is ScheduleFile {
  const f = raw as Partial<ScheduleFile> | null;
  return !!f && f.version === 1 && Array.isArray(f.schedules) && typeof f.runs === "object" && f.runs !== null;
}

/**
 * Load the file. Missing → empty. Unreadable or the wrong shape → moved aside
 * as `schedules.json.damaged-<ms>` and empty: starting empty and saving over it
 * would erase the operator's schedules for good.
 */
export async function loadSchedules(path: string = resolveSchedulesPath()): Promise<ScheduleFile> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return empty();
    // Unreadable (EACCES, EISDIR, etc.) → move aside
    await rename(path, `${path}.damaged-${Date.now()}`).catch(() => undefined);
    return empty();
  }
  try {
    const raw: unknown = JSON.parse(text);
    if (isScheduleFile(raw)) return raw;
  } catch {
    /* fall through to setting it aside */
  }
  await rename(path, `${path}.damaged-${Date.now()}`).catch(() => undefined);
  return empty();
}

/** Write through a temporary file in the same folder, so a crash never leaves half a file. */
export async function saveSchedules(file: ScheduleFile, path: string = resolveSchedulesPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(file, null, 2), "utf8");
  await rename(tmp, path);
}
