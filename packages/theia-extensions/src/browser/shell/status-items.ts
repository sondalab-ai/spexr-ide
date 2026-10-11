/**
 * Which status bar entries the bar keeps, and in what order (S6d, S1/S2, D14).
 * Lumen's bar has the branch, the sync state, the problem count and the
 * agents on the left; the caret's place, the encoding, the line ends and the
 * language on the right. Theia's other entries (indentation, the language
 * status "{}", the panel toggle) and spexr's project item are not on it.
 *
 * Free of Theia's classes (the entry is read structurally), so the policy runs
 * in plain node; `SpexrStatusBarViewModel` applies it to every entry set.
 */

/** Theia's indentation entry: "Spaces: 2". */
export const TABBING_ID = "editor-status-tabbing-config";
/** Theia's language status entry "{}", and the id the language mode entry gives its pinned items as affinity. */
export const LANGUAGE_STATUS_ID = "editor-language-status-items";
export const LANGUAGE_MODE_ID = "editor-status-language";
/** The bottom panel's toggle (`BOTTOM_PANEL_TOGGLE_ID`). */
export const PANEL_TOGGLE_ID = "bottom-panel-toggle";
/** spexr's resource meter. */
export const RESOURCES_ID = "spexr-resources";

/** Entries that are never shown. */
export const HIDDEN_STATUS_IDS: readonly string[] = [TABBING_ID, LANGUAGE_STATUS_ID, PANEL_TOGGLE_ID];

/**
 * The right side's order, left to right: Ln/Col, UTF-8, LF, language.
 * Theia's own priorities put the line ends before the encoding, so they are
 * replaced; a higher priority is further left. The resource meter, when the
 * preference shows it, comes after them.
 */
export const RIGHT_ORDER: readonly string[] = ["editor-status-cursor-position", "editor-status-encoding", "editor-status-eol", LANGUAGE_MODE_ID, RESOURCES_ID];

/** The first rank, high enough to sit before any entry a plugin adds on the right. */
const RIGHT_BASE_PRIORITY = 10_000;

/** The part of a status bar entry the policy reads and may replace. */
export interface ShapableEntry {
  readonly priority?: number;
  readonly affinity?: { readonly id: string };
}

/** What decides an entry: whether the resource meter's preference is on. */
export interface StatusPolicy {
  readonly resources: boolean;
}

/**
 * The entry as the bar shows it, or undefined where it is not shown: the
 * hidden ids, the pinned language items hanging on the language mode entry,
 * and the resource meter while its preference is off. The right side's
 * entries get their place in {@link RIGHT_ORDER}.
 */
export function shapeStatusEntry<T extends ShapableEntry>(id: string, entry: T, policy: StatusPolicy): T | undefined {
  if (HIDDEN_STATUS_IDS.includes(id)) return undefined;
  if (entry.affinity?.id === LANGUAGE_MODE_ID) return undefined;
  if (id === RESOURCES_ID && !policy.resources) return undefined;
  const place = RIGHT_ORDER.indexOf(id);
  return place < 0 ? entry : { ...entry, priority: RIGHT_BASE_PRIORITY - place };
}
