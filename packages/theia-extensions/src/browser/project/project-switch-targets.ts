/**
 * The tile fields the target list needs; `AgentTile` satisfies it.
 *
 * Structural rather than the protocol type so tests can build a session origin
 * from three fields instead of a full tile.
 */
export interface SessionOrigin {
  readonly projectPath: string;
  readonly projectName: string;
  readonly lastActivityMs: number;
}

/** One project the user can jump to, as rendered in the switch quick-pick. */
export interface ProjectTarget {
  /** Absolute filesystem path of the project root. */
  path: string;
  /** Last path segment — the quick-pick label. */
  name: string;
  /** How many agent sessions on the Darkfactory wall belong to this project. */
  sessions: number;
  /** Most recent session activity (epoch ms); 0 when no session is on the wall. */
  lastActivityMs: number;
}

/** Drop trailing slashes so the same root compares equal however it was spelled. */
export function normalizeProjectPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, "");
  return trimmed || path.trim();
}

/** Last path segment, without importing node:path into the browser bundle. */
function baseName(path: string): string {
  const parts = normalizeProjectPath(path).split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Build the ordered list of projects the user can switch to.
 *
 * Projects with a session on the wall come first, most recently active first —
 * jumping to an agent's project is the case this feature exists for. The
 * remaining recent workspaces follow in the order Theia returns them, which is
 * already most-recent-first. The project currently loaded is excluded: there is
 * nothing to switch to.
 *
 * @param recentPaths Recent workspace roots, as filesystem paths, most recent first.
 * @param sessions    Sessions currently on the Darkfactory wall.
 * @param currentPath The loaded project root, when a workspace is open.
 */
export function buildProjectTargets(
  recentPaths: readonly string[],
  sessions: readonly SessionOrigin[],
  currentPath?: string,
): ProjectTarget[] {
  const current = currentPath ? normalizeProjectPath(currentPath) : undefined;
  const byPath = new Map<string, ProjectTarget>();

  for (const session of sessions) {
    const path = normalizeProjectPath(session.projectPath);
    if (!path || path === current) continue;
    const existing = byPath.get(path);
    if (existing) {
      existing.sessions += 1;
      existing.lastActivityMs = Math.max(existing.lastActivityMs, session.lastActivityMs);
      continue;
    }
    byPath.set(path, {
      path,
      name: session.projectName || baseName(path),
      sessions: 1,
      lastActivityMs: session.lastActivityMs,
    });
  }

  const active = [...byPath.values()].sort((a, b) => b.lastActivityMs - a.lastActivityMs);

  const recents: ProjectTarget[] = [];
  for (const raw of recentPaths) {
    const path = normalizeProjectPath(raw);
    if (!path || path === current || byPath.has(path)) continue;
    byPath.set(path, { path, name: baseName(path), sessions: 0, lastActivityMs: 0 });
    recents.push(byPath.get(path)!);
  }

  return [...active, ...recents];
}
