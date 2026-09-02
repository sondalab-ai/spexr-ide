import type { AgentTile, AgentState } from "../../common/darkfactory-protocol.js";

/** Coarse "time ago" bucket for a past epoch-ms timestamp. */
export function relativeTime(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Human label for a session state. */
export function stateLabel(state: AgentState): string {
  return state === "working" ? "Working" : state === "idle" ? "Idle" : "Done";
}

const STATE_RANK: Record<AgentState, number> = { working: 0, idle: 1, done: 2 };

/** Lower = higher attention. Needs-you always outranks state. */
export function attentionRank(state: AgentState, needsYou: boolean): number {
  return (needsYou ? 0 : 1) * 10 + STATE_RANK[state];
}

/** Needs-you → working → idle → done, then most-recently-active first. */
export function sortTiles(tiles: AgentTile[]): AgentTile[] {
  return [...tiles].sort(
    (a, b) =>
      attentionRank(a.state, a.needsYou) - attentionRank(b.state, b.needsYou) ||
      b.lastActivityMs - a.lastActivityMs,
  );
}

/** Human label for a permission mode; never a bare token. */
export function permissionLabel(mode: string | undefined): string {
  switch (mode) {
    case "auto":
      return "Auto-approve tools";
    case "plan":
      return "Plan mode";
    case "default":
      return "Ask each time";
    default:
      return mode ? mode : "Ask each time";
  }
}

/** Human label for a non-default `mode`; undefined for the default so it stays hidden. */
export function modeLabel(mode: string | undefined): string | undefined {
  if (!mode || mode === "normal") return undefined;
  return mode.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** One project's sessions, as rendered under a single header on the wall. */
export interface TileGroup {
  /** Group identity — two checkouts may share a name, never a path. */
  projectPath: string;
  /** Header copy: the project name, suffixed with its parent folder when the name is ambiguous. */
  label: string;
  /** True when this is the project loaded in the window. */
  isCurrent: boolean;
  /** Shared by every member, since the accent derives from `projectPath`. */
  accentId: number;
  /** Members in {@link sortTiles} order. */
  tiles: AgentTile[];
}

/** Drop trailing slashes so `/x` and `/x/` name the same project. */
function trimPath(path: string): string {
  return path.replace(/\/+$/, "");
}

/** Name of the folder containing `path`; empty when there is none. */
function parentFolder(path: string): string {
  const parts = path.split("/").filter((p) => p.length > 0);
  return parts.length >= 2 ? parts[parts.length - 2]! : "";
}

/**
 * Bucket sessions by project. Members keep the flat attention order; groups lead
 * with the project loaded in this window, then by their most urgent member, then
 * by the most recent activity — so a group only moves when its own state does.
 */
export function groupTiles(tiles: AgentTile[], currentProjectPath?: string): TileGroup[] {
  const byPath = new Map<string, AgentTile[]>();
  for (const tile of tiles) {
    const bucket = byPath.get(tile.projectPath);
    if (bucket) bucket.push(tile);
    else byPath.set(tile.projectPath, [tile]);
  }
  // A name shared by two checkouts is not an identity — say which one this is.
  const nameCount = new Map<string, number>();
  for (const [, members] of byPath) {
    const name = members[0]!.projectName;
    nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }
  const groups: TileGroup[] = [];
  for (const [projectPath, members] of byPath) {
    const sorted = sortTiles(members);
    const head = sorted[0]!;
    const parent = parentFolder(projectPath);
    const ambiguous = (nameCount.get(head.projectName) ?? 0) > 1 && parent !== "";
    groups.push({
      projectPath,
      label: ambiguous ? `${head.projectName} — ${parent}` : head.projectName,
      isCurrent: currentProjectPath !== undefined && trimPath(projectPath) === trimPath(currentProjectPath),
      accentId: head.accentId,
      tiles: sorted,
    });
  }
  return groups.sort(
    (a, b) =>
      Number(b.isCurrent) - Number(a.isCurrent) ||
      attentionRank(a.tiles[0]!.state, a.tiles[0]!.needsYou) -
        attentionRank(b.tiles[0]!.state, b.tiles[0]!.needsYou) ||
      Math.max(...b.tiles.map((t) => t.lastActivityMs)) - Math.max(...a.tiles.map((t) => t.lastActivityMs)),
  );
}

/**
 * Which sessions are worth an AI summary. The flat attention order comes first, so
 * one churning project cannot starve the rest; the lead session of each visible
 * group is then added, because a group's first card is a headline position and an
 * empty summary there reads as broken rather than as a budget.
 */
export function summaryTargets(
  tiles: AgentTile[],
  currentProjectPath: string | undefined,
  flatCount: number,
  groupCount: number,
): string[] {
  const ids = sortTiles(tiles)
    .slice(0, flatCount)
    .map((t) => t.sessionId);
  const seen = new Set(ids);
  for (const group of groupTiles(tiles, currentProjectPath).slice(0, groupCount)) {
    const head = group.tiles[0]!;
    if (!seen.has(head.sessionId)) {
      seen.add(head.sessionId);
      ids.push(head.sessionId);
    }
  }
  return ids;
}

/** A project the new-session launcher can start in. */
export interface LaunchTarget {
  readonly path: string;
  readonly name: string;
}

/** Last path segment, for a project the wall has never scanned. */
function pathName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/**
 * Projects the launcher offers: every project on the wall, plus the window's own
 * even when it has no session yet. The current project leads, so the common case
 * needs no choice; the rest are alphabetical.
 */
export function launchTargets(tiles: AgentTile[], currentProjectPath?: string): LaunchTarget[] {
  const byPath = new Map<string, LaunchTarget>();
  for (const tile of tiles) {
    if (!byPath.has(tile.projectPath)) {
      byPath.set(tile.projectPath, { path: tile.projectPath, name: tile.projectName });
    }
  }
  if (currentProjectPath && !byPath.has(currentProjectPath)) {
    byPath.set(currentProjectPath, { path: currentProjectPath, name: pathName(currentProjectPath) });
  }
  const rest = [...byPath.values()]
    .filter((t) => t.path !== currentProjectPath)
    .sort((a, b) => a.name.localeCompare(b.name));
  const current = currentProjectPath ? byPath.get(currentProjectPath) : undefined;
  return current ? [current, ...rest] : rest;
}
