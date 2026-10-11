/**
 * Class hooks for spexr's own status bar entries (`StatusBarEntry.className`),
 * read by spexr.css's status dock (the kit's .sl-statusbar on Theia's bar).
 * Theia's own entries are reached by their ids instead.
 */

/** A fact read as data, whole: the mono at the primary ink. Only the model value (S6d, D15) is set this way; the branch's name is {@link STATUS_BRANCH}'s. */
export const STATUS_DATA = "spexr-status--data";

/** The branch entry: its name is the one run of text set as data; the counts and the rest stay the bar's muted sans (S6d, D15). */
export const STATUS_BRANCH = "spexr-status--branch";

/** The divergence entry beside the branch ("↑2"): flush against the branch's pill, muted sans (S6d). */
export const STATUS_DIVERGENCE = "spexr-status--divergence";

/** A state that is live (a job running, a download in progress): a dot of the accent before it. */
export const STATUS_LIVE = "spexr-status--live";

/**
 * The `className` for an entry: data, live, both or neither. Neither is the
 * empty string, which Theia's status bar skips (it appends a truthy className).
 */
export function statusClass(flags: { data?: boolean; live?: boolean }): string {
  return [flags.data ? STATUS_DATA : "", flags.live ? STATUS_LIVE : ""].filter(Boolean).join(" ");
}
