import { CLAUDE_TERMINAL_ID } from "./claude-terminal-id.js";

/**
 * The Agent tile's count badge (S6d, A3): the number of running agents, drawn
 * on the activity bar's agent terminal tile and nowhere else. Nothing at 0,
 * as the title bar's pill. Pure: the decorator feeds it the count.
 */
export function agentBadge(widgetId: string, running: number): Array<{ badge: number }> {
  return widgetId === CLAUDE_TERMINAL_ID && running > 0 ? [{ badge: running }] : [];
}
