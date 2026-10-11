import type { AgentPaneSnapshot } from "../../common/agent-pane-protocol.js";
import type { AgentTile } from "../../common/darkfactory-protocol.js";
import type { HarnessId } from "../../common/harness/harness-types.js";
import { STALE_MS } from "../../common/session-timing.js";
import { defaultSessionName, sortTiles } from "../darkfactory/darkfactory-format.js";
import { normalizeProjectPath } from "../project/project-switch-targets.js";
import { modelFamily } from "../agent-pane/agent-pane-format.js";

/** The most rows the Sessions part lists; it scrolls in a small window, and older sessions live on the wall. */
export const SESSION_ROWS_MAX = 12;

/**
 * A session's state as its row says it. `done` is every session that is not
 * working: Dark Factory's `idle` is a session with no process, which the list
 * calls done as the demo does.
 */
export type SessionRowState = "running" | "waiting" | "done";

export interface SessionRow {
  readonly sessionId: string;
  readonly name: string;
  readonly state: SessionRowState;
  /** `state · age · n tools`: the age is left out while the session runs. */
  readonly meta: string;
  /** Which agent CLI wrote it: only a Claude session can be followed in the pane. */
  readonly harness: HarnessId;
}

/** The rows shown, and how many more sessions of the workspace the cap left out. */
export interface SessionRows {
  readonly rows: SessionRow[];
  readonly more: number;
}

/** A span of time as the list writes it: `now`, `5m`, `1h`, `3d`. */
export function formatAge(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** `14 tools`, `1 tool`; undefined while the transcript has not been counted. */
export function toolsLabel(count: number | undefined): string | undefined {
  if (count === undefined) return undefined;
  return `${count} ${count === 1 ? "tool" : "tools"}`;
}

/** The word a row leads with. */
export function rowState(tile: Pick<AgentTile, "state" | "needsYou">): SessionRowState {
  if (tile.needsYou) return "waiting";
  return tile.state === "working" ? "running" : "done";
}

/** The row's second line: `running · 14 tools`, `done · 1h · 212 tools`. */
export function rowMeta(tile: AgentTile, now: number): string {
  const state = rowState(tile);
  const parts: string[] = [state];
  if (state !== "running") parts.push(formatAge(now - tile.lastActivityMs));
  const tools = toolsLabel(tile.toolCount);
  if (tools) parts.push(tools);
  return parts.join(" · ");
}

/** Whether a session's project is one of the workspace's roots or lies inside one. */
export function inWorkspace(projectPath: string, roots: readonly string[]): boolean {
  const path = normalizeProjectPath(projectPath);
  return roots.some((root) => {
    const r = normalizeProjectPath(root);
    return path === r || path.startsWith(`${r}/`);
  });
}

/**
 * The workspace's sessions as rows: the tiles of every root and its subfolders,
 * needs-you and working first and then the most recent, capped at
 * {@link SESSION_ROWS_MAX}. The session the pane follows is always shown and
 * selected: past the cap it is pinned at the end. `more` counts what the cap
 * left out (the list says "N more" and opens the wall).
 */
export function sessionRows(
  tiles: readonly AgentTile[],
  roots: readonly string[],
  now: number,
  followedId?: string,
  /** The name the agent pane's head gives the session it follows: it reads the names file afresh, which a scan may not have yet. */
  followedTitle?: { readonly sessionId: string; readonly title?: string | undefined },
): SessionRows {
  if (roots.length === 0) return { rows: [], more: 0 };
  const sorted = sortTiles(tiles.filter((t) => inWorkspace(t.projectPath, roots)));
  const shown = sorted.slice(0, SESSION_ROWS_MAX);
  const followed = followedId && !shown.some((t) => t.sessionId === followedId) ? sorted.find((t) => t.sessionId === followedId) : undefined;
  if (followed) shown.push(followed);
  const rows = shown.map((t) => ({
    sessionId: t.sessionId,
    name: (t.customName?.trim() ? undefined : followedTitle?.sessionId === t.sessionId ? followedTitle.title : undefined) || defaultSessionName(t) || t.sessionId.slice(0, 8),
    state: rowState(t),
    meta: rowMeta(t, now),
    harness: t.harness,
  }));
  return { rows, more: sorted.length - shown.length };
}

/** The row an arrow key, Home or End moves focus to from `current`; the ends stay put. Nothing is followed by moving. */
export function focusTarget(rows: readonly SessionRow[], current: string | undefined, key: "ArrowDown" | "ArrowUp" | "Home" | "End"): string | undefined {
  if (rows.length === 0) return undefined;
  if (key === "Home") return rows[0]!.sessionId;
  if (key === "End") return rows[rows.length - 1]!.sessionId;
  const delta = key === "ArrowDown" ? 1 : -1;
  const at = rows.findIndex((r) => r.sessionId === current);
  const next = at === -1 ? (delta > 0 ? 0 : rows.length - 1) : Math.min(rows.length - 1, Math.max(0, at + delta));
  return rows[next]!.sessionId;
}

/**
 * Which session the pane should follow after a click on `clicked`: the agent
 * terminal's own session means "back to my agent" (undefined, no override);
 * any other is a read-only follow of it.
 */
export function viewTarget(clicked: string, ownSessionId: string | undefined): string | undefined {
  return clicked === ownSessionId ? undefined : clicked;
}

export interface AgentsPill {
  readonly agents: number;
  /** Tool calls summed over the agents counted: the live sessions only. */
  readonly tools: number;
  readonly text: string;
}

/**
 * The status bar's pill: how many agents run and the tool calls they have
 * made between them. `live` is the tiles of the running agents (the title
 * bar's count, held the same way); a finished session's calls are not in it.
 * Undefined at 0: nothing is drawn.
 */
export function agentsPill(live: readonly Pick<AgentTile, "toolCount">[]): AgentsPill | undefined {
  if (live.length === 0) return undefined;
  const tools = live.reduce((sum, t) => sum + (t.toolCount ?? 0), 0);
  const agents = `${live.length} ${live.length === 1 ? "agent" : "agents"}`;
  return { agents: live.length, tools, text: tools > 0 ? `${agents} · ${toolsLabel(tools)}` : agents };
}

/** The tok/s a model streams, as the status bar writes it: `86`, `1.2k`. */
export function formatTokPerSec(value: number): string {
  const n = Math.round(value);
  if (n < 1000) return String(n);
  return `${(Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, "")}k`;
}

/**
 * The status bar's model item: the family and the rate of the latest completed
 * message. Undefined (hidden) with no model or rate, and when the reply is not
 * recent: the session is not working (the backend's own call, from the
 * transcript file's age) and its last entry is older than {@link STALE_MS}. A
 * rate read from an hour-old reply is not what the agent does now.
 */
export function modelItem(snapshot: Pick<AgentPaneSnapshot, "model" | "tokPerSec" | "updatedAtMs" | "state"> | undefined, now: number): { readonly family: string; readonly text: string } | undefined {
  if (!snapshot?.model || !snapshot.tokPerSec || snapshot.tokPerSec <= 0) return undefined;
  const recent = snapshot.updatedAtMs !== undefined && now - snapshot.updatedAtMs <= STALE_MS;
  if (snapshot.state !== "working" && !recent) return undefined;
  const family = modelFamily(snapshot.model);
  if (!family) return undefined;
  return { family, text: `${family} · ${formatTokPerSec(snapshot.tokPerSec)} tok/s` };
}

/**
 * Whether the Sessions part must be added to a view container that was just
 * created: it is the Explorer's, and it does not hold the part already. Reset
 * Layout and a restored layout both build a fresh container, and the part
 * would otherwise be lost with the old one.
 */
export function shouldAddSessionsPart(factoryId: string, explorerFactoryId: string, hasPart: boolean): boolean {
  return factoryId === explorerFactoryId && !hasPart;
}
