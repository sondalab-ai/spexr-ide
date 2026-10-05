/**
 * The title bar's derivations, kept free of Theia so they run in plain node:
 * the crumb, the agents badge, the bell's name, the avatar's initials.
 * SpexrTitleBarWidget feeds them from the workspace, the editor manager,
 * Dark Factory, the notification manager and git.
 */

import type { KeyCaps } from "../views/key-caps.js";

/** The command the command field runs, and whose keys it shows: Theia's Quick Open (file-search). */
export const QUICK_OPEN_COMMAND = "file-search.openFile";

/** The command field's keycaps: every key of the binding, chord after chord, and its ARIA name. */
export interface FieldKeys {
  readonly caps: readonly string[];
  readonly aria?: string;
}

/**
 * The command field's keys from the binding's keycaps (boundKeyCaps, which
 * reads Theia's keybinding registry): "⌘", "P" on macOS, "Ctrl", "P" elsewhere.
 * Undefined when the user has unbound Quick Open: the field then shows no keys.
 */
export function fieldKeys(caps: KeyCaps | undefined): FieldKeys | undefined {
  if (!caps) return undefined;
  return { caps: caps.chords.flat(), ...(caps.aria ? { aria: caps.aria } : {}) };
}

/** How many of the active file's folders the crumb names; deeper ones fold into "…". */
export const CRUMB_FOLDERS = 2;

/** The crumb's stand-in for folded folders. */
export const CRUMB_ELLIPSIS = "…";

/** Last segment of a slash path, without importing node:path into the browser bundle. */
function baseName(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || path;
}

/** Whether `path` is `root` or lies under it, on a segment boundary. */
function isUnder(path: string, root: string): boolean {
  const base = root.replace(/\/+$/, "");
  return path === base || path.startsWith(`${base}/`);
}

/**
 * The crumb: the workspace root holding the active file, the file's folders
 * below that root (the last {@link CRUMB_FOLDERS}, deeper ones folded into
 * {@link CRUMB_ELLIPSIS}), then the file. With no active file, the first
 * root's name alone. A file outside every root shows its own folder and name,
 * never a root it does not belong to. Paths are URI paths (forward slashes).
 */
export function titleCrumb(roots: readonly string[], file?: string): string[] {
  if (!file) return roots[0] ? [baseName(roots[0])] : [];
  const root = roots.filter((r) => isUnder(file, r)).sort((a, b) => b.length - a.length)[0];
  const segments = file.split("/").filter(Boolean);
  const name = segments.pop() ?? file;
  if (!root) return segments.length ? [segments[segments.length - 1]!, name] : [name];
  const rootDepth = root.split("/").filter(Boolean).length;
  const folders = segments.slice(rootDepth);
  const shown = folders.length > CRUMB_FOLDERS ? [CRUMB_ELLIPSIS, ...folders.slice(-CRUMB_FOLDERS)] : folders;
  return [baseName(root), ...shown, name];
}

/** The part of a Dark Factory tile the badge reads. */
export interface TileState {
  readonly state: string;
}

/** Sessions working right now: Dark Factory's "working" state, one per live agent. */
export function runningAgents(tiles: readonly TileState[]): number {
  return tiles.filter((t) => t.state === "working").length;
}

/** The agents badge's words, or undefined at 0: the badge is not drawn when nothing runs. */
export function agentsLabel(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count === 1 ? "1 agent running" : `${count} agents running`;
}

/**
 * The bell's accessible name. The state is in the words, because forced
 * colours drop the dot (the kit's `__btn--dot` contract). The count is
 * Theia's: the notifications in the centre, as its status-bar item counted.
 */
export function bellLabel(count: number): string {
  if (count <= 0) return "Notifications";
  return `Notifications, ${count} unread`;
}

/**
 * Up to two initials from a git `user.name`: the first letters of the first
 * and last words ("Marcello Barile" → "MB"), the first two letters of a
 * single word ("marcello" → "MA"). Undefined for a missing or blank name.
 */
export function initials(name: string | undefined): string | undefined {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return undefined;
  const letters = (w: string): string[] => Array.from(w).filter((c) => /\p{L}|\p{N}/u.test(c));
  const first = letters(words[0]!);
  if (words.length === 1) return first.slice(0, 2).join("").toUpperCase() || undefined;
  const last = letters(words[words.length - 1]!);
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase() || undefined;
}
