/**
 * The Darkfactory tab's words (S6c, D8): "Agents" for the wall, and
 * "Agent · <name>" while one session is lifted into a card, named as the card
 * is (the newest card when several are open). The tab wears the sparkle, as
 * Lumen's agent tab.
 */
export const AGENTS_TAB_ICON = "codicon codicon-sparkle";

/** The separator Lumen's tab puts between "Agent" and the name. */
export const AGENT_TAB_SEPARATOR = " · ";

/** The tab's label: "Agents", or "Agent · <name>" for a non-empty name. */
export function agentsTabLabel(name?: string): string {
  const trimmed = name?.trim();
  return trimmed ? `Agent${AGENT_TAB_SEPARATOR}${trimmed}` : "Agents";
}
