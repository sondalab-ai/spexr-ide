/**
 * Class hooks for spexr's own status bar entries (`StatusBarEntry.className`),
 * read by spexr.css's status dock (the kit's .sl-statusbar on Theia's bar).
 * Theia's own entries are reached by their ids instead.
 */

/** A fact read as data (a branch, a project, a count): the mono at the primary ink, as written. */
export const STATUS_DATA = "spexr-status--data";

/** A state that is live (a job running, a download in progress): a dot of the accent before it. */
export const STATUS_LIVE = "spexr-status--live";

/**
 * The `className` for an entry: data, live, both or neither. Neither is the
 * empty string, which Theia's status bar skips (it appends a truthy className).
 */
export function statusClass(flags: { data?: boolean; live?: boolean }): string {
  return [flags.data ? STATUS_DATA : "", flags.live ? STATUS_LIVE : ""].filter(Boolean).join(" ");
}
