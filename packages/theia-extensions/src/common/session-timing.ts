/**
 * A live session whose transcript has not been written for this long is dormant,
 * not working: real work (tools, inferences) writes far more often, so a longer
 * silence means the process is stuck at a prompt or was abandoned mid-turn. This
 * caps the "working" state so a leftover `claude` process does not pulse forever.
 */
export const STALE_MS = 10 * 60_000;
