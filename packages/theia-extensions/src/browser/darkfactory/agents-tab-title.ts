/**
 * The Darkfactory tab's words (S6c, D8): "Agents" for the wall, and
 * "Agent · <name>" while one session is lifted into a card, named as the card
 * is (the newest card when several are open). The tab wears the sparkle, as
 * Lumen's agent tab.
 */
export const AGENTS_TAB_ICON = "codicon codicon-sparkle";

/** The separator Lumen's tab puts between "Agent" and the name. */
export const AGENT_TAB_SEPARATOR = " · ";

/** The longest name a tab carries, in characters: a tab is not a card heading. */
export const AGENT_TAB_NAME_MAX = 40;

/** The name cut to {@link AGENT_TAB_NAME_MAX} characters on a word boundary where there is one, ending in an ellipsis. */
export function clipTabName(name: string, max: number = AGENT_TAB_NAME_MAX): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The tab's label: "Agents", or "Agent · <name>" for a non-empty name, cut to a tab's width. */
export function agentsTabLabel(name?: string): string {
  const trimmed = name?.trim();
  return trimmed ? `Agent${AGENT_TAB_SEPARATOR}${clipTabName(trimmed)}` : "Agents";
}
