import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { SessionIndex } from "./session-index.js";

/**
 * Where the session index lives. Global on purpose: sessions span every project
 * and both Claude config dirs, so the code index's per-workspace `.spexr/`
 * location does not apply. `SPEXR_SESSION_INDEX` overrides it for tests.
 */
export function resolveSessionIndexPath(env: NodeJS.ProcessEnv = process.env): string {
  return env["SPEXR_SESSION_INDEX"] ?? join(homedir(), ".spexr", "sessions-index.json");
}

/** Load the persisted index; any failure yields an empty one the crawl refills. */
export async function loadSessionIndex(
  path: string = resolveSessionIndexPath(),
): Promise<SessionIndex> {
  try {
    return SessionIndex.fromJSON(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return new SessionIndex();
  }
}

/**
 * Persist the index through a temporary file in the same directory, so a crash
 * mid-write leaves the previous index intact rather than a truncated one.
 */
export async function saveSessionIndex(
  index: SessionIndex,
  path: string = resolveSessionIndexPath(),
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(index.toJSON()), "utf8");
  await rename(tmp, path);
}
