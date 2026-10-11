/**
 * What the resource meter's preference (`spexr.statusBar.resources`, off by
 * default) asks of the poller (S6d, D14): start it when the meter is turned on
 * and idle, stop it when turned off while it runs, else leave it. Pure, so the
 * gate is tested apart from Theia.
 */
export type PollAction = "start" | "stop" | "none";

export function pollAction(enabled: boolean, running: boolean): PollAction {
  if (enabled && !running) return "start";
  if (!enabled && running) return "stop";
  return "none";
}
