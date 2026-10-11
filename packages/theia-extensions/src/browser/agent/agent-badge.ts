import { CLAUDE_TERMINAL_ID } from "./claude-terminal-id.js";
import { agentsLabel } from "../titlebar/titlebar-model.js";

/**
 * The Agent tile's count badge (S6d, A3): the number of running agents, drawn
 * on the activity bar's agent terminal tile and nowhere else, with the count in
 * words as a tooltip ("2 agents running": Theia appends it to the tab's own,
 * and mutates nothing, so a terminal that rewrites its caption cannot undo it).
 * Nothing at 0, as the title bar's pill. Pure: the decorator feeds it the count.
 */
export function agentBadge(widgetId: string, running: number): Array<{ badge: number; tooltip: string }> {
  const tooltip = agentsLabel(running);
  return widgetId === CLAUDE_TERMINAL_ID && tooltip ? [{ badge: running, tooltip }] : [];
}
