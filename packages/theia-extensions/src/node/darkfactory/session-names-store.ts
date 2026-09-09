import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Where the names the user gave sessions live. Global for the same reason the
 * session index is: sessions span every project and both Claude config dirs, so
 * a per-workspace `.spexr/` file would lose a name the moment the wall showed
 * another project. `SPEXR_SESSION_NAMES` overrides it for tests.
 */
export function resolveSessionNamesPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["SPEXR_SESSION_NAMES"] ?? join(homedir(), ".spexr", "session-names.json");
}

/**
 * Load the names as a `sessionId → name` map. Any failure yields an empty map:
 * a missing or damaged file must leave the wall usable, only unnamed.
 */
export async function loadSessionNames(
  path: string = resolveSessionNamesPath(),
): Promise<Map<string, string>> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (typeof raw !== "object" || raw === null) return new Map();
    const entries = Object.entries(raw as Record<string, unknown>).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    );
    return new Map(entries);
  } catch {
    return new Map();
  }
}

/**
 * Persist the names through a temporary file in the same directory, so a crash
 * mid-write leaves the previous names intact rather than a truncated file.
 */
export async function saveSessionNames(
  names: Map<string, string>,
  path: string = resolveSessionNamesPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(Object.fromEntries(names), null, 2), "utf8");
  await rename(tmp, path);
}
