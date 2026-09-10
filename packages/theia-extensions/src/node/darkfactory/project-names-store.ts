import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Where the names the user gave projects live. Global for the same reason the
 * session names are: the wall shows every project at once, so a per-workspace
 * file would lose the name of every project but the one that is open.
 * `SPEXR_PROJECT_NAMES` overrides it for tests.
 */
export function resolveProjectNamesPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["SPEXR_PROJECT_NAMES"] ?? join(homedir(), ".spexr", "project-names.json");
}

/**
 * The key a project is stored under. Trailing slashes are dropped so `/x` and
 * `/x/` name one project: the path reaches this store from the group header,
 * the tile scan and the workspace root, and those do not agree on the slash.
 */
export function projectNameKey(projectPath: string): string {
  const trimmed = projectPath.trim().replace(/\/+$/, "");
  return trimmed || projectPath.trim();
}

/**
 * Load the names as a `projectPath → name` map. Any failure yields an empty
 * map: a missing or damaged file must leave the wall usable, only unnamed.
 */
export async function loadProjectNames(
  path: string = resolveProjectNamesPath(),
): Promise<Map<string, string>> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof raw !== "object" || raw === null) return new Map();
    const entries = Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, name]): [string, string] => [projectNameKey(key), name]);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

/**
 * Persist the names through a temporary file in the same directory, so a crash
 * mid-write leaves the previous names intact rather than a truncated file.
 */
export async function saveProjectNames(
  names: Map<string, string>,
  path: string = resolveProjectNamesPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(Object.fromEntries(names), null, 2), "utf8");
  await rename(tmp, path);
}
